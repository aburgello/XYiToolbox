// =============================================================================
// src/js/main/tools/BatchTracker.tsx
// -----------------------------------------------------------------------------
// ONE BATCH, LINED UP BY DELIVERABLE. Each deliverable lives in four places --
// its artwork in JPG_PNG, its project in AE, its render in Renders, its
// delivered file in _Delivery (never _mp4, which is previews) -- plus a Wrike subtask. This shows them
// side by side, so "what's left on Norway Batch_02" is one screen, and a name
// that disagrees between two of them (Norway's "Post" project against its
// "Digital MetroPOST" artwork) is flagged the moment both exist, not when MC
// It! or Deliver quietly skips it.
//
// READ-ONLY. It lists folders (tracker.ts) and opens Finder windows; it never
// moves, renames or writes anything. Near misses are POINTED OUT, never
// joined -- the rule every matcher here keeps.
//
// The strip at the top is "where is it": one press to each of the batch's
// folders and the territory's Specs, and to the open project's own art and
// render when the open project is in this batch.
//
// WRIKE LEADS. When the batch has a job in the feed, its subtasks ARE the
// list -- they are what has to be delivered -- and every row starts folded to
// one line: name, four stage pips, and either a count of problems or a tick.
// Opening a row shows its stages (each a Finder link) and the problems in
// words. What sits on disk but is not in Wrike folds into one line at the
// bottom: usually a misnamed file, which the near misses already point at.
// With no job in the feed it falls back to everything on disk.
// =============================================================================
import React, { useEffect, useState } from "react";
import { Image as ImageIcon, FileBox, Film, PackageCheck, FileText, RefreshCw, Loader2, AlertTriangle, MapPin, Search, ChevronRight, Check, HardDrive } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import Dropdown from "../Dropdown";
import { fetchJobs, parseJobTitle, statusTint, type WrikeJob } from "../lib/jobsFeed";
import { jobTerritory } from "./DeliveryJobs";
import { readFinderColors, revealInFinder, type FinderColor } from "../lib/finderLabels";
import "./BatchTracker.scss";

interface Row {
    key: string;
    name: string;
    art?: { path: string; files: number };
    aep?: { name: string; path: string; version: number; versions: number };
    render?: { name: string; path: string; version: number; versions: number; all: string[] };
    delivered?: { name: string; path: string };
    wrike?: { name: string; status: string };
    near?: { stage: string; name: string; why: string }[];
}
interface Scan { territory: string; batch: string; folders: { art: string; aep: string; renders: string; delivered: string[]; specs: string }; rows: Row[] }

const loose = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|\D)0+(\d)/g, "$1$2");
/** A row's problems, in words. A near miss REPLACES the plain "missing" line
 *  for its stage: "the project is named X" says more than "no project". */
export function rowIssues(r: Row, color: string): string[] {
    const out: string[] = [];
    const near = r.near || [];
    const nearOn = (label: RegExp) => near.some((n) => label.test(n.stage));
    for (const n of near) out.push(`The ${n.stage} is named ${n.name}: ${n.why}.`);
    if (!r.art && !nearOn(/^art/)) out.push("No artwork folder in JPG_PNG.");
    if (!r.aep && !nearOn(/^project/)) out.push("No project in AE.");
    if (!r.render && !nearOn(/^render/) && r.wrike && /prep|deliver|review|revised/i.test(r.wrike.status)) out.push(`Not rendered, but Wrike says ${r.wrike.status}.`);
    if (r.render && color === "red") out.push("The newest render is marked red in Finder.");
    return out;
}

const stem = (p: string) => (p.split(/[\\/]/).pop() || p).replace(/\.[^.]+$/, "").replace(/_V\d+$/i, "").toUpperCase();

const BatchTracker: React.FC = () => {
    const [territoryPath, setTerritoryPath] = useState("");
    const [territory, setTerritory] = useState("");
    const [batches, setBatches] = useState<string[]>([]);
    const [batch, setBatch] = useState("");
    const [openProject, setOpenProject] = useState("");
    const [scan, setScan] = useState<Scan | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [colors, setColors] = useState<Record<string, FinderColor>>({});
    const [onlyIssues, setOnlyIssues] = useState(false);
    const [ready, setReady] = useState(false);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [showExtra, setShowExtra] = useState(false);

    // Where the open project sits decides the first view.
    useEffect(() => {
        (async () => {
            try {
                const c = (await evalTS("trackerContext")) as any;
                if (c && c.territoryPath) {
                    setTerritoryPath(c.territoryPath);
                    setTerritory(c.territory || "");
                    setBatches(c.batches || []);
                    setBatch(c.batch || "");
                }
                if (c && c.projectPath) setOpenProject(c.projectPath);
            } catch { /* preview */ }
            setReady(true);
        })();
    }, []);

    // The Wrike subtasks of THIS territory's job for THIS batch, if the feed
    // has one: same code, same batch number (a title with none is batch 1).
    const wrikeFor = async (terr: string, b: string): Promise<{ name: string; status: string }[]> => {
        try {
            const state = (await evalTS("teamGetMachineState")) as { owner?: string } | undefined;
            const owner = (state && state.owner) || "";
            if (!owner) return [];
            const code = String((await evalTS("getTerritoryCountryCode", terr)) || "").toUpperCase();
            if (!code) return [];
            const res = await fetchJobs(owner);
            if (res.mock) return [];
            const out: { name: string; status: string }[] = [];
            res.jobs.filter((j: WrikeJob) => jobTerritory(j) === code && loose(parseJobTitle(j.title).batch.replace(/\s*POST$/i, "")) === loose(b.replace(/_?POST$/i, "")))
                .forEach((j) => (j.subtasks || []).forEach((st) => { if (st.name) out.push({ name: st.name, status: st.customStatusName || st.status || "" }); }));
            return out;
        } catch {
            return [];
        }
    };

    const run = async (tp = territoryPath, b = batch, terr = territory) => {
        if (!tp || !b) return;
        setBusy(true);
        setError("");
        try {
            const wrike = await wrikeFor(terr, b);
            const r = (await evalTSSafe("trackerScan", JSON.stringify({ territoryPath: tp, batch: b, wrike }))) as any;
            if (!r || !r.success) { setError((r && r.error) || "Couldn't read the batch."); return; }
            setScan({ territory: r.territory, batch: r.batch, folders: r.folders, rows: r.rows || [] });
            setOpen({});
            setShowExtra(false);
            // Finder colours on the newest renders: green/orange good, red not.
            const paths = (r.rows || []).filter((x: Row) => x.render).map((x: Row) => x.render!.path);
            setColors(await readFinderColors(paths));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => { if (ready && territoryPath && batch) void run(); }, [ready, territoryPath, batch]);

    const pick = async () => {
        const r = (await evalTS("trackerPickFolder")) as any;
        if (!r || !r.territoryPath) return;
        const b = (await evalTS("trackerBatches", r.territoryPath)) as any;
        setTerritoryPath(r.territoryPath);
        setTerritory(r.territoryPath.split(/[\\/]/).pop() || "");
        setBatches((b && b.batches) || []);
        setBatch(r.batch || ((b && b.batches) || [])[0] || "");
    };

    const all = scan ? scan.rows : [];
    const fromWrike = all.some((r) => !!r.wrike);
    // Wrike's subtasks are the list when there are any; the rest is extra.
    const rows = fromWrike ? all.filter((r) => !!r.wrike) : all;
    const extra = fromWrike ? all.filter((r) => !r.wrike) : [];
    const count = (f: (r: Row) => boolean) => rows.filter(f).length;
    const colorOf = (r: Row) => (r.render ? colors[r.render.path] || "" : "");
    const issuesOf = (r: Row) => rowIssues(r, colorOf(r));
    const issue = (r: Row): boolean => issuesOf(r).length > 0;
    const shown = onlyIssues ? rows.filter(issue) : rows;
    const openStem = openProject ? stem(openProject) : "";
    const openRow = all.find((r) => r.aep && stem(r.aep.path) === openStem);
    const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

    const Link: React.FC<{ icon: React.ReactNode; label: string; path?: string; folder?: boolean }> = ({ icon, label, path, folder }) => (
        <button type="button" className="bt-link" disabled={!path} title={path || `No ${label.toLowerCase()} for this batch`} onClick={() => path && revealInFinder(path, !!folder)}>
            {icon}<span>{label}</span>
        </button>
    );

    const Dot: React.FC<{ on: boolean; label: string; title: string; path?: string; folder?: boolean; extra?: React.ReactNode; tone?: string }> = ({ on, label, title, path, folder, extra, tone }) => (
        <button type="button" className={"bt-stage" + (on ? " is-on" : "") + (tone ? " is-" + tone : "")} disabled={!path} title={title} onClick={() => path && revealInFinder(path, !!folder)}>
            <span className="bt-stage-dot" />
            <span className="bt-stage-label">{label}</span>
            {extra}
        </button>
    );

    const renderRow = (r: Row, isExtra: boolean) => {
        const c = colorOf(r);
        const isHere = !!openRow && openRow.key === r.key;
        const problems = issuesOf(r);
        const isOpen = !!open[r.key];
        const label = r.wrike ? r.wrike.name : r.name;
        const pip = (on: boolean, bad = false) => <i className={"bt-pip" + (on ? " is-on" : "") + (bad ? " is-bad" : "")} />;
        return (
            <div key={r.key} className={"bt-row" + (isHere ? " is-here" : "") + (problems.length ? " has-issue" : "") + (isOpen ? " is-open" : "") + (isExtra ? " is-extra" : "")}>
                <button type="button" className="bt-row-top" onClick={() => toggle(r.key)} aria-expanded={isOpen}>
                    <ChevronRight size={13} className="bt-chev" />
                    {isHere && <MapPin size={12} className="bt-here-pin" aria-label="Open in AE" />}
                    <span className="bt-name" title={isHere ? label + " (open in AE)" : label}>{label}</span>
                    <span className="bt-pips" title="Art · Built · Rendered · Delivered">
                        {pip(!!r.art)}{pip(!!r.aep)}{pip(!!r.render, c === "red")}{pip(!!r.delivered)}
                    </span>
                    {problems.length > 0
                        ? <span className="bt-issues" title={problems.join("\n")}><AlertTriangle size={11} />{problems.length}</span>
                        : <span className="bt-ok" title="Nothing to look at"><Check size={12} /></span>}
                    {r.wrike && (
                        <span className="bt-wrike" style={{ color: statusTint(r.wrike.status).color, background: statusTint(r.wrike.status).background }} title="Wrike">{r.wrike.status || "Wrike"}</span>
                    )}
                </button>
                {isOpen && (
                    <div className="bt-detail">
                        <div className="bt-stages">
                            <Dot on={!!r.art} label="Art" folder path={r.art?.path} title={r.art ? `${r.art.files} image${r.art.files === 1 ? "" : "s"} in JPG_PNG` : "No JPG_PNG folder with this name"} />
                            <Dot on={!!r.aep} label="Built" path={r.aep?.path} title={r.aep ? r.aep.name : "No project with this name in AE"} extra={r.aep && r.aep.version ? <em>V{String(r.aep.version).padStart(2, "0")}</em> : null} />
                            <Dot on={!!r.render} label="Rendered" path={r.render?.path} tone={c === "red" ? "bad" : c === "green" || c === "orange" ? "good" : ""}
                                title={r.render ? `${r.render.name}${r.render.versions > 1 ? ` (newest of ${r.render.versions})` : ""}${c ? ` · marked ${c} in Finder` : ""}` : "No render in this batch's Renders folder"}
                                extra={r.render ? <em>V{String(r.render.version).padStart(2, "0")}{c ? <i className={"bt-fc is-" + c} /> : null}</em> : null} />
                            <Dot on={!!r.delivered} label="Delivered" path={r.delivered?.path} title={r.delivered ? r.delivered.name : "Not in _Delivery yet"} />
                        </div>
                        {problems.length === 0 && <p className="bt-fine"><Check size={11} /> Nothing to look at.</p>}
                        {problems.map((t, i) => (
                            <p key={i} className="bt-near"><AlertTriangle size={11} /> <span>{t}</span></p>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    if (!ready) return <div className="bt"><p className="bt-note"><Loader2 size={13} className="spin" /> Reading where the open project is…</p></div>;

    return (
        <div className="bt">
            <div className="bt-head">
                <div className="bt-where">
                    <span className="bt-title">{territory ? territory.replace(/_/g, " ") : "No territory"}</span>
                </div>
                {batches.length > 0 && (
                    <Dropdown value={batch} onChange={setBatch} options={batches.map((b) => ({ value: b, label: b }))} className="bt-batch" />
                )}
                <button type="button" className="bt-btn" onClick={() => void pick()} title="Pick a territory, or a batch in its AE folder">
                    <Search size={13} /> Other…
                </button>
                <button type="button" className="bt-btn bt-icon" disabled={busy || !batch} onClick={() => void run()} aria-label="Refresh" title="Read the folders again">
                    <RefreshCw size={13} className={busy ? "spin" : ""} />
                </button>
            </div>

            {!territoryPath && (
                <p className="bt-note">Open a project inside a territory's AE folder, or press Other… to pick one.</p>
            )}
            {error && <p className="bt-note is-bad">{error}</p>}

            {scan && (
                <>
                    {/* WHERE IS IT: one press to each of the batch's folders. */}
                    <div className="bt-links">
                        <Link icon={<ImageIcon size={13} />} label="Art" path={scan.folders.art} folder />
                        <Link icon={<FileBox size={13} />} label="AE" path={scan.folders.aep} folder />
                        <Link icon={<Film size={13} />} label="Renders" path={scan.folders.renders} folder />
                        <Link icon={<PackageCheck size={13} />} label="Delivered" path={scan.folders.delivered[0]} folder />
                        <Link icon={<FileText size={13} />} label="Specs" path={scan.folders.specs} folder />
                    </div>
                    {openRow && (
                        <div className="bt-links bt-links--here">
                            <span className="bt-here"><MapPin size={12} /> Open project</span>
                            <Link icon={<ImageIcon size={13} />} label="Its art" path={openRow.art?.path} folder />
                            <Link icon={<Film size={13} />} label="Its render" path={openRow.render?.path} />
                        </div>
                    )}

                    <div className="bt-summary">
                        <span><strong>{rows.length}</strong> {fromWrike ? `in Wrike` : `on disk`}</span>
                        <span className="bt-count">{count((r) => !!r.art)} art</span>
                        <span className="bt-count">{count((r) => !!r.aep)} built</span>
                        <span className="bt-count">{count((r) => !!r.render)} rendered</span>
                        <span className="bt-count">{count((r) => !!r.delivered)} delivered</span>
                        <span className="bt-spacer" />
                        <button type="button" className={"bt-btn" + (onlyIssues ? " is-on" : "")} onClick={() => setOnlyIssues(!onlyIssues)}>
                            <AlertTriangle size={12} /> {count(issue)} to look at
                        </button>
                    </div>

                    <div className="bt-rows">
                        {!fromWrike && all.length > 0 && <p className="bt-note">No Wrike job for this batch in your feed, so this is everything on disk.</p>}
                        {shown.length === 0 && <p className="bt-note">{onlyIssues ? "Nothing to look at in this batch." : "Nothing in this batch yet."}</p>}
                        {shown.map((r) => renderRow(r, false))}
                        {extra.length > 0 && (
                            <>
                                <button type="button" className={"bt-extra" + (showExtra ? " is-open" : "")} onClick={() => setShowExtra(!showExtra)}
                                    title="Files in this batch's folders with no Wrike subtask of the same name">
                                    <ChevronRight size={13} className="bt-chev" /><HardDrive size={12} />
                                    <span>{extra.length} on disk, not in Wrike</span>
                                </button>
                                {showExtra && extra.map((r) => renderRow(r, true))}
                            </>
                        )}
                    </div>
                </>
            )}
            {busy && !scan && <p className="bt-note"><Loader2 size={13} className="spin" /> Reading the batch…</p>}
        </div>
    );
};

export default BatchTracker;
