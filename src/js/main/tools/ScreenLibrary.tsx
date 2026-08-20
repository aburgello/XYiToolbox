// =============================================================================
// src/js/main/tools/ScreenLibrary.tsx
// -----------------------------------------------------------------------------
// THE SCREEN LIBRARY -- what replaces the templates folder, in two moves.
//
// MOVE ONE, and it works on day one: the library is an INDEX over the folder
// you already have. Seeding walks the templates root and files every .aep by
// the path it sits on -- Country then Venue, which is the shape DOOH_Specs is
// already in -- so the panel can answer "which screen is this" without anyone
// migrating a thing. Nothing is opened, copied or written back to that folder;
// `bespokeLibraryScan` reads names and nothing else.
//
// MOVE TWO happens by itself: every time somebody lays a screen out in Bespoke
// and saves, that screen gets a LAYOUT, and the layout supersedes the template.
//
// SO THE TWO KINDS LOOK DIFFERENT ON PURPOSE. A layout draws its real geometry
// -- you recognise the screen from across the room. A template can't, because
// its geometry is locked inside an .aep nobody is allowed to open casually, so
// it draws as an untraced outline and says so. The grid therefore shows, at a
// glance, how much of the folder has actually been absorbed, and it visibly
// improves as the studio works. That progress IS the feature: a migration
// nobody has to schedule.
//
// Design notes that are not obvious:
//   - No aspect-ratio, no color-mix, no clamp -- chrome74 target. The
//     wireframes are plain SVG with a computed scale, so they need none of it.
//   - Durations come from Bespoke's own scale (--dur-fast/--dur), which is
//     deliberately shorter than the motion skill's 0.3-0.4s. This is a dense
//     docked panel, not a landing page, and that calibration is already
//     written down in Bespoke.scss.
//   - Territory is whatever buckets exist on disk, NEVER a country enum:
//     MENA, META, Domestic and Football Super Boards all sit in that column
//     alongside Argentina.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
// FolderOpen for "show me the file", FolderSearch for "go and scan a folder" --
// two different jobs that were both wearing the magnifier variant.
import { Download, FolderOpen, FolderSearch, Image as ImageIcon, Layers, Search, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { enrichScreens, isAvailable as enrichAvailable } from "../lib/screenEnrich";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "./ScreenLibrary.scss";

/** Mirrors aeft/team.ts's BespokeTemplate. Everything after `stamp` is optional. */
export interface ScreenEntry {
    id: string;
    name: string;
    territory: string;
    site: string;
    canvasW: number;
    canvasH: number;
    guidesX: number[];
    guidesY: number[];
    slots: {
        x: number; y: number; w: number; h: number; rotation: number;
        masterW: number; masterH: number; masterDuration: string;
    }[];
    savedBy: string;
    stamp: string;
    kind?: "layout" | "template";
    templatePath?: string;
    screen?: string;
    status?: "active" | "archive";
    referencePath?: string;
    referencePaths?: string[];
}

interface ScanCandidate {
    id: string;
    territory: string;
    screen: string;
    name: string;
    templatePath: string;
    canvasW: number;
    canvasH: number;
    known: boolean;
    superseded: boolean;
}

/**
 * Absent `kind` means "layout" -- entries written before the library shipped
 * are already on the share and had no other kind. Read defensively everywhere
 * rather than migrating the file, which would need a write nobody asked for.
 */
const kindOf = (e: ScreenEntry): "layout" | "template" => (e.kind === "template" ? "template" : "layout");

/**
 * The screen drawn at true proportion, slots and all.
 *
 * This is the whole reason the library beats the folder: GRAND_REX and
 * BEAUGRENELLE are equally meaningless as names, and completely distinct as
 * shapes. Everything needed is already stored -- canvas size and the slot
 * rects -- so a wireframe costs no extra data and no extra round trip.
 */
const Wireframe: React.FC<{ entry: ScreenEntry; band: number }> = ({ entry, band }) => {
    const cw = entry.canvasW || 0;
    const ch = entry.canvasH || 0;
    if (!cw || !ch) return null;

    // Fit the canvas inside the band, never upscaling past it. Plain arithmetic
    // rather than an aspect-ratio box, which is banned at this target.
    //
    // The width cap is what keeps a 13536x3072 ceiling inside its 132px card
    // instead of bleeding through the grid track -- DOOH ratios go past 4:1
    // routinely, so height alone is not the binding constraint.
    const maxW = band * 2;
    const scale = Math.min(maxW / cw, band / ch);
    const w = Math.max(6, Math.round(cw * scale));
    const h = Math.max(4, Math.round(ch * scale));

    return (
        <svg className="scl-wire" width={w} height={h} viewBox={`0 0 ${cw} ${ch}`} role="presentation">
            <rect className="scl-wire-canvas" x="0" y="0" width={cw} height={ch} />
            {/* Guides first, so a slot edge sitting on one stays readable. */}
            {(entry.guidesX || []).map((g, i) => (
                <line key={`x${i}`} className="scl-wire-guide" x1={g} y1="0" x2={g} y2={ch} vectorEffect="non-scaling-stroke" />
            ))}
            {(entry.guidesY || []).map((g, i) => (
                <line key={`y${i}`} className="scl-wire-guide" x1="0" y1={g} x2={cw} y2={g} vectorEffect="non-scaling-stroke" />
            ))}
            {(entry.slots || []).map((s, i) => (
                <rect
                    key={i}
                    className="scl-wire-slot"
                    x={s.x}
                    y={s.y}
                    width={Math.max(1, s.w)}
                    height={Math.max(1, s.h)}
                    vectorEffect="non-scaling-stroke"
                />
            ))}
        </svg>
    );
};

/**
 * A template has no geometry to draw, and inventing one would be a lie about
 * what is actually known. It gets a hatched outline instead -- the size from
 * its filename when that parsed, an anonymous box when it did not.
 */
const UntracedMark: React.FC<{ entry: ScreenEntry; band: number }> = ({ entry, band }) => {
    // A template whose filename did not carry a size gets a neutral 16:9 box
    // rather than no mark at all -- it is still a screen, and section 5's rule
    // about silently dropping what fails to parse applies to drawing it too.
    const cw = entry.canvasW || 16;
    const ch = entry.canvasH || 9;
    const maxW = band * 2;
    const scale = Math.min(maxW / cw, band / ch);
    const w = Math.max(6, Math.round(cw * scale));
    const h = Math.max(4, Math.round(ch * scale));
    // The pattern id must be unique per instance: SVG ids are document-global,
    // and every card rendering the same one means they all resolve to whichever
    // mounted first -- which then breaks the rest when it unmounts.
    const hatchId = `scl-hatch-${entry.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
    return (
        <svg className="scl-wire is-untraced" width={w} height={h} viewBox="0 0 100 100" preserveAspectRatio="none" role="presentation">
            <defs>
                <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="1.4" />
                </pattern>
            </defs>
            <rect x="0" y="0" width="100" height="100" fill={`url(#${hatchId})`} opacity="0.5" />
            <rect className="scl-wire-canvas" x="0" y="0" width="100" height="100" />
        </svg>
    );
};

const ScreenCard: React.FC<{
    entry: ScreenEntry;
    onLoad: () => void;
    onTrace: () => void;
    onImport: () => void;
    onReveal: () => void;
    onDelete: () => void;
    busy: boolean;
    isActive: boolean;
}> = ({ entry, onLoad, onTrace, onImport, onReveal, onDelete, busy, isActive }) => {
    const kind = kindOf(entry);
    const size = entry.canvasW && entry.canvasH ? `${entry.canvasW}×${entry.canvasH}` : "size unknown";
    const regions = (entry.slots || []).length;

    return (
        <div className={"scl-card is-" + kind + (isActive ? " is-active" : "")}>
            {/* REMOVE LIVES IN THE CORNER, not in the action row. Four controls
                across a 132px card left the primary button about 40px and its
                label wrapped. Removing is also the rarest thing you do here and
                the only destructive one, so it has no business sitting at the
                same weight as Trace. */}
            {/* NO <Tooltip> HERE, and it must stay that way. Tooltip's wrapper
                span is `position: relative` (Tooltip.scss:2), so it becomes the
                containing block for anything absolute inside it -- this button
                then anchored to a zero-width inline-flex wrapper sitting in the
                card's flex column instead of to the card, and rendered as an
                empty box floating over the artwork. A plain `title` does the
                job for a control that already has an aria-label. */}
            <button
                className="scl-card-x"
                onClick={onDelete}
                disabled={busy}
                aria-label="Remove"
                title={kind === "layout" ? "Remove this layout from the library" : "Remove this template from the library"}
            >
                <X size={10} />
            </button>
            <div className="scl-card-art">
                {kind === "layout" ? <Wireframe entry={entry} band={52} /> : <UntracedMark entry={entry} band={52} />}
            </div>

            <div className="scl-card-name" title={entry.name}>{entry.name}</div>
            <div className="scl-card-meta">
                <span className="scl-card-size">{size}</span>
                {kind === "layout" ? (
                    <span className="scl-card-regions">{regions} region{regions === 1 ? "" : "s"}</span>
                ) : (
                    // A template with a reference is no longer a dead end: the
                    // artist can trace it immediately, which is the whole point
                    // of the enrichment pass.
                    <span className={entry.referencePath ? "scl-card-hasref" : "scl-card-untraced"}>
                        {entry.referencePath ? "has reference" : "untraced"}
                    </span>
                )}
            </div>

            {/* THE PRIMARY ACTION DIFFERS BY KIND, because the two are not the
                same offer. A layout drops straight onto the board. A template
                is imported read-only for the artist to work from -- it is a
                starting point, not a result. */}
            <div className="scl-card-do">
                {kind === "layout" && (
                    <button className="scl-do" onClick={onLoad} disabled={busy}>Load</button>
                )}
                {/* THE PAYOFF. A template whose in-situ image we found is not a
                    file to go and open -- it is a board you can start drawing
                    on. That outranks Import, which drops back to the icon. */}
                {/* TEXT ONLY on the primary. A leading icon plus `gap` inside a
                    centred flex button offsets the label -- the glyph is part of
                    the centred group, so the word never sits in the middle of
                    the button. At this size the label alone is clearer anyway;
                    icons earn their place on the icon-only buttons beside it. */}
                {kind === "template" && entry.referencePath && (
                    <button className="scl-do scl-do--alt" onClick={onTrace} disabled={busy}>
                        Trace
                    </button>
                )}
                {kind === "template" && !entry.referencePath && (
                    <button className="scl-do scl-do--alt" onClick={onImport} disabled={busy}>
                        Import
                    </button>
                )}
                {kind === "template" && entry.referencePath && (
                    <Tooltip text="Import the template .aep into this project">
                        <button className="scl-icon" onClick={onImport} disabled={busy} aria-label="Import the template">
                            <Download size={11} />
                        </button>
                    </Tooltip>
                )}
                {kind === "template" && (
                    <Tooltip text="Show the .aep in Finder">
                        <button className="scl-icon" onClick={onReveal} disabled={busy} aria-label="Reveal in Finder">
                            <FolderOpen size={11} />
                        </button>
                    </Tooltip>
                )}
            </div>
        </div>
    );
};

const ScreenLibrary: React.FC<{
    open: boolean;
    entries: ScreenEntry[];
    onClose: () => void;
    onLoad: (e: ScreenEntry) => void;
    /** Adopt this screen's reference image and canvas, ready to draw regions on. */
    onTrace: (e: ScreenEntry) => void;
    /** The screen currently on the board, so the grid can say where you are. */
    activeId?: string;
    onReload: () => void;
    onStatus: (text: string, type: "success" | "error") => void;
    /**
     * A country to open filtered to, when the artist arrived here asking for
     * one. Applied ONCE per value, never on every render: after that the rail
     * is theirs, and re-asserting it would fight every click they make.
     */
    initialTerritory?: string;
}> = ({ open, entries, onClose, onLoad, onTrace, activeId, onReload, onStatus, initialTerritory }) => {
    const reduced = useReducedMotion();
    const [territory, setTerritory] = useState("");

    const appliedTerritory = useRef<string | null>(null);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [scan, setScan] = useState<{ root: string; candidates: ScanCandidate[]; scanned: number } | null>(null);
    // Non-empty while the template reader is running; carries its own progress
    // line, because reading 200 .aep binaries off the NAS is not instant and a
    // silent button for that long reads as a hang.
    const [enriching, setEnriching] = useState("");

    useEffect(() => {
        if (!open) { setScan(null); return; }
        setQuery("");
    }, [open]);

    const live = useMemo(
        () => entries.filter((e) => e.status !== "archive"),
        [entries]
    );

    // A territory that has gone -- the last screen in it was removed, or a
    // reseed renamed it -- would otherwise leave the grid permanently empty
    // with no clue why, since the rail no longer shows what is selected.
    useEffect(() => {
        if (!territory) return;
        // AN EMPTY LIST IS NOT A GONE TERRITORY. The library reads its
        // templates asynchronously, so `live` is empty for the first render or
        // two -- and clearing on that wiped a filter the moment it was set,
        // which is what stopped "take me to the Germany layouts" arriving
        // filtered. "Nothing loaded yet" and "that country no longer exists"
        // are different answers, and only the second one should clear.
        if (!live.length) return;
        const stillThere = live.filter((e) => (e.territory || "Unfiled") === territory).length > 0;
        if (!stillThere) setTerritory("");
    }, [live, territory]);

    /**
     * A country asked for from outside — the Ask agent sending somebody
     * straight to "the Germany layouts".
     *
     * RESOLVED AGAINST WHAT IS ACTUALLY ON DISK, case-insensitively, rather
     * than trusted verbatim. The rail groups by the exact stored string, so
     * "germany" would filter to nothing and look like an empty library. If no
     * stored territory matches, the filter is left alone: showing everything is
     * a better wrong answer than showing nothing.
     *
     * Waits for the entries to arrive — applying before they load would match
     * nothing and burn the one-shot.
     */
    useEffect(() => {
        if (!initialTerritory || !live.length) return;
        if (appliedTerritory.current === initialTerritory) return;

        const want = initialTerritory.trim().toLowerCase();
        let match = "";
        for (const e of live) {
            const t = e.territory || "Unfiled";
            if (t.toLowerCase() === want) { match = t; break; }
        }
        // Marked applied either way: a country with no screens is an answer,
        // and retrying it on every entries change would fight the artist's own
        // clicks for as long as the panel is open.
        appliedTerritory.current = initialTerritory;
        if (match) setTerritory(match);
    }, [initialTerritory, live]);

    const territories = useMemo(() => {
        // Whatever is on disk, counted -- never a country list. Sorted by name
        // so the column reads like the Finder column it mirrors.
        const seen: Record<string, number> = {};
        live.forEach((e) => {
            const t = e.territory || "Unfiled";
            seen[t] = (seen[t] || 0) + 1;
        });
        return Object.keys(seen).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, count: seen[name] }));
    }, [live]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return live
            .filter((e) => !territory || (e.territory || "Unfiled") === territory)
            .filter((e) => {
                if (!q) return true;
                const hay = `${e.name} ${e.territory} ${e.screen || ""} ${e.canvasW}x${e.canvasH}`.toLowerCase();
                return hay.indexOf(q) !== -1;
            })
            .sort((a, b) => {
                // Traced screens first: the library should lead with the thing
                // it wants more of, and a template is the state being retired.
                const ka = kindOf(a) === "layout" ? 0 : 1;
                const kb = kindOf(b) === "layout" ? 0 : 1;
                if (ka !== kb) return ka - kb;
                return a.name.localeCompare(b.name);
            });
    }, [live, territory, query]);

    // The migration, stated plainly. Not decoration -- it is the one number
    // that says whether the folder can be turned off yet.
    const traced = useMemo(() => live.filter((e) => kindOf(e) === "layout").length, [live]);
    const pct = live.length ? Math.round((traced / live.length) * 100) : 0;
    const untraced = useMemo(
        () => live.filter((e) => kindOf(e) === "template" && e.templatePath).length,
        [live]
    );
    const withRef = useMemo(() => live.filter((e) => !!e.referencePath).length, [live]);

    const runScan = async () => {
        setBusy(true);
        try {
            const root = await evalTS("bespokeSelectTemplatesRoot");
            if (typeof root !== "string" || !root) { setBusy(false); return; }
            const res = await evalTS("bespokeLibraryScan", root);
            if (res && res.success && res.candidates) {
                setScan({ root, candidates: res.candidates as ScanCandidate[], scanned: res.scanned || 0 });
            } else {
                onStatus((res && res.error) || "Couldn't read that folder.", "error");
            }
        } catch {
            onStatus("No CEP bridge detected. Open this panel inside After Effects to run it.", "error");
        }
        setBusy(false);
    };

    const commitScan = async () => {
        if (!scan || scan.candidates.length === 0) return;
        setBusy(true);
        try {
            // EVERYTHING goes up, not just the new rows. The backend decides
            // what each one means: new screens are added, an existing TEMPLATE
            // has its path refreshed because .aep files move inside that folder
            // all the time, and an existing LAYOUT is left completely alone --
            // a reseed must never undo somebody's tracing.
            const res = await evalTS("bespokeLibrarySeed", JSON.stringify(scan.candidates));
            if (res && res.success) {
                const added = res.added || 0;
                onStatus(
                    added > 0
                        ? `Added ${added} screen${added === 1 ? "" : "s"} to the library.`
                        : "No new screens — the paths already here were refreshed.",
                    "success"
                );
                setScan(null);
                onReload();
            } else {
                onStatus((res && res.error) || "Couldn't write to the library.", "error");
            }
        } catch {
            onStatus("Couldn't reach After Effects to save that.", "error");
        }
        setBusy(false);
    };

    const importTemplate = async (e: ScreenEntry) => {
        setBusy(true);
        try {
            const res = await evalTS("bespokeLibraryImport", e.templatePath || "");
            if (res && res.success) onStatus(`Imported "${res.name || e.name}" into this project.`, "success");
            else onStatus((res && res.error) || "Couldn't import that template.", "error");
        } catch {
            onStatus("Couldn't reach After Effects to import that.", "error");
        }
        setBusy(false);
    };

    const revealTemplate = async (e: ScreenEntry) => {
        try {
            const res = await evalTS("bespokeLibraryReveal", e.templatePath || "");
            if (res && !res.success) onStatus(res.error || "Couldn't show that file.", "error");
        } catch {
            /* no bridge -- nothing to reveal, and nothing worth shouting about */
        }
    };

    /**
     * Reads every template in the library for its in-situ / spec image.
     *
     * ONLY THE REFERENCE IS FILED. aep_screens.py also returns slot geometry,
     * and it is deliberately not applied: measured over the real estate it is
     * right about 42% of the time, and a wrong slot silently rearranges
     * somebody's board where a wrong reference costs one click to replace.
     * Slots want a confirm step before they go anywhere near the shared file.
     */
    const runEnrich = async () => {
        const templates = live.filter((e) => kindOf(e) === "template" && e.templatePath);
        if (templates.length === 0) { onStatus("No templates to read.", "error"); return; }

        const ready = enrichAvailable();
        if (!ready.ready) { onStatus(ready.why, "error"); return; }

        setBusy(true);
        setEnriching(`Reading ${templates.length} templates…`);
        try {
            const res = await enrichScreens(
                templates.map((e) => e.templatePath as string),
                (line) => setEnriching(line)
            );
            if (!res.ok || !res.results) {
                onStatus(res.message, "error");
            } else {
                // EVERY candidate is filed, not just the winner. The scoring is
                // a heuristic and gets it wrong often enough that the artist
                // needs to be able to step to the next one on the canvas.
                const byPath: Record<string, string[]> = {};
                const fromSpecs: Record<string, boolean> = {};
                res.results.forEach((r) => {
                    // NOT gated on r.ok. A template py-aep can't parse still has
                    // a Specs folder beside it on disk, and those screens have
                    // never had a reference of any kind.
                    const list = (r.references || []).map((x) => x.path).filter(Boolean);
                    if (list.length === 0 && r.ok && r.reference) list.push(r.reference);
                    if (list.length) byPath[r.path] = list;
                    const best = (r.references || [])[0];
                    if (best && best.source === "specs") fromSpecs[r.path] = true;
                });
                // Templates that were READ but yielded nothing send an empty
                // path, which clears whatever is on the row. That is what makes
                // a re-run self-correcting rather than additive -- a reference
                // filed by an older, worse heuristic has to be able to go away.
                // Templates that could NOT be read send nothing at all, so an
                // unmounted share or an unreadable .aep never wipes good data.
                const readable: Record<string, boolean> = {};
                res.results.forEach((r) => { if (r.ok) readable[r.path] = true; });
                const rows = templates
                    // An unreadable template is filed only when the disk gave
                    // us something: sending it an empty list would clear a good
                    // reference on the strength of a failure.
                    .filter((e) => readable[e.templatePath as string] || byPath[e.templatePath as string])
                    .map((e) => {
                        const list = byPath[e.templatePath as string] || [];
                        return { id: e.id, referencePath: list[0] || "", referencePaths: list };
                    });
                const unreadable = res.results.filter((r) => !r.ok).length;

                const found = rows.filter((r) => !!r.referencePath).length;
                // Said out loud in the status line, because it is the answer to
                // "why does this screen suddenly have one": it came off the
                // disk beside the template, not out of the .aep.
                const specCount = templates.filter(
                    (e) => fromSpecs[e.templatePath as string] && (byPath[e.templatePath as string] || []).length
                ).length;
                if (rows.length === 0) {
                    onStatus(`Couldn't read any of those ${templates.length} templates.`, "error");
                } else if (found === 0) {
                    onStatus(`No references found in ${rows.length} readable templates.`, "error");
                } else {
                    const saved = await evalTS("bespokeLibrarySetReferences", JSON.stringify(rows));
                    if (saved && saved.success) {
                        // The templates that could not be READ are named in the
                        // count rather than quietly ignored -- roughly one in
                        // fifteen is on an AE version py-aep can't open, and a
                        // silent shortfall is the failure mode to avoid.
                        onStatus(
                            `Found references for ${saved.updated} screen${saved.updated === 1 ? "" : "s"}` +
                            (specCount ? `, ${specCount} from a Specs folder` : "") +
                            (unreadable ? ` — ${unreadable} template${unreadable === 1 ? "" : "s"} couldn't be read.` : "."),
                            "success"
                        );
                        onReload();
                    } else {
                        onStatus((saved && saved.error) || "Couldn't save the references.", "error");
                    }
                }
            }
        } catch (e) {
            onStatus("Couldn't run the template reader.", "error");
        }
        setEnriching("");
        setBusy(false);
    };

    const removeEntry = async (e: ScreenEntry) => {
        setBusy(true);
        try {
            const res = await evalTS("bespokeTemplateDelete", e.id);
            if (res && res.success) { onStatus(`Removed "${e.name}".`, "success"); onReload(); }
            else onStatus((res && res.error) || "Couldn't remove that.", "error");
        } catch {
            onStatus("Couldn't reach After Effects to remove that.", "error");
        }
        setBusy(false);
    };

    if (!open) return null;

    const newCount = scan ? scan.candidates.filter((c) => !c.known).length : 0;

    return (
        <div className="scl">
            <div className="scl-head">
                <span className="scl-title"><Layers size={12} /> Screen library</span>

                <span className="scl-search">
                    <Search size={11} />
                    <input
                        className="scl-search-in"
                        value={query}
                        placeholder="Find a screen…"
                        onChange={(ev) => setQuery(ev.target.value)}
                    />
                </span>

                <button className="scl-ghost" onClick={runScan} disabled={busy}>
                    <FolderSearch size={11} /> Seed from templates…
                </button>
                {untraced > 0 && (
                    <Tooltip text="Read each template for the in-situ image inside it, without opening After Effects">
                        <button className="scl-ghost" onClick={runEnrich} disabled={busy}>
                            <ImageIcon size={11} /> Find references
                        </button>
                    </Tooltip>
                )}
                <button className="scl-x" onClick={onClose} aria-label="Close the library"><X size={12} /></button>
            </div>

            {/* THE SCAN REPORT IS A CONFIRMATION, not a result. Nothing has been
                written at this point -- a mis-picked folder costs a glance,
                not 400 junk rows on everyone's share. */}
            {scan && (
                <div className="scl-scan">
                    <div className="scl-scan-say">
                        <StatusIcon type={newCount ? "success" : "error"} size={12} />
                        <span>
                            {scan.scanned} template{scan.scanned === 1 ? "" : "s"} under{" "}
                            <em>{scan.root.split("/").pop() || scan.root}</em> —{" "}
                            <strong>{newCount} new</strong>
                            {scan.candidates.length - newCount > 0
                                ? `, ${scan.candidates.length - newCount} already here`
                                : ""}
                        </span>
                    </div>
                    <div className="scl-scan-do">
                        <button className="scl-do" onClick={commitScan} disabled={busy || scan.candidates.length === 0}>
                            {newCount > 0 ? `Add ${newCount}` : "Refresh paths"}
                        </button>
                        <button className="scl-ghost" onClick={() => setScan(null)}>Cancel</button>
                    </div>
                </div>
            )}

            {enriching && (
                <p className="scl-progress" title={enriching}>{enriching}</p>
            )}

            <div className="scl-body">
                <div className="scl-rail">
                    <button
                        className={"scl-terr" + (territory === "" ? " is-on" : "")}
                        onClick={() => setTerritory("")}
                    >
                        All<em>{live.length}</em>
                    </button>
                    {territories.map((t) => (
                        <button
                            key={t.name}
                            className={"scl-terr" + (territory === t.name ? " is-on" : "")}
                            onClick={() => setTerritory(t.name)}
                            title={t.name}
                        >
                            {t.name}<em>{t.count}</em>
                        </button>
                    ))}
                </div>

                <div className="scl-grid">
                    {shown.length === 0 && (
                        <p className="scl-none">
                            {live.length === 0
                                ? "Nothing here yet. Seed it from your templates folder, or save a layout from a board you've built."
                                : "No screen matches that."}
                        </p>
                    )}
                    {shown.map((e, i) => (
                        <motion.div
                            key={e.id}
                            className="scl-cell"
                            initial={reduced ? false : { opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            // Per-item explicit delay rather than nested
                            // staggerChildren, and capped so a library of 300
                            // does not spend four seconds arriving.
                            transition={{ duration: 0.13, delay: reduced ? 0 : Math.min(i, 12) * 0.014 }}
                        >
                            <ScreenCard
                                entry={e}
                                busy={busy}
                                isActive={!!activeId && e.id === activeId}
                                // NEITHER CLOSES THE LIBRARY. Picking a screen
                                // is rarely the last thing you do with it --
                                // you trace one, look at the board, come back
                                // for the next candidate or the next screen in
                                // the same country. Auto-closing threw away the
                                // country, the search and the scroll position
                                // every time.
                                onLoad={() => onLoad(e)}
                                onTrace={() => onTrace(e)}
                                onImport={() => importTemplate(e)}
                                onReveal={() => revealTemplate(e)}
                                onDelete={() => removeEntry(e)}
                            />
                        </motion.div>
                    ))}
                </div>
            </div>

            {live.length > 0 && (
                <div className="scl-foot">
                    <span className="scl-bar">
                        <span className="scl-bar-fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="scl-foot-say">
                        {traced} of {live.length} screens traced
                        {withRef > 0 ? ` · ${withRef} with a reference ready to trace` : " — the rest still point at the old templates"}
                    </span>
                </div>
            )}
        </div>
    );
};

export default ScreenLibrary;
