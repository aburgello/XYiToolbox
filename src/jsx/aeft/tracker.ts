// =============================================================================
// src/jsx/aeft/tracker.ts -- the Batch Tracker's backend. READ-ONLY throughout:
// it lists folders and nothing else. No open, no save, no move, no rename.
// -----------------------------------------------------------------------------
// ONE DELIVERABLE LIVES IN FOUR PLACES, named one way:
//
//   <Territory>/JPG_PNG/<Batch>/<deliverable>/        the artwork   (Art)
//   <Territory>/AE/<Batch>/<deliverable>_V01.aep      the project   (Built)
//   <Territory>/Renders/<Batch>/<deliverable>_V02.mov the render    (Rendered)
//   …/Renders/<Batch>/_Delivery or Renders/_Delivery  the delivered file
//
// `_mp4` is NOT delivery -- it holds previews -- so it is never read here.
//
// plus its Wrike subtask, which the panel supplies. Until now each tool looked
// at one of those; this lines them up by deliverable so "what's left on Chile
// Batch_02" is one screen, and a name that differs between two of them shows
// up the moment both exist rather than when MC It! or Deliver quietly skips it.
//
// THE KEY is the deliverable's name with its version, a _DOUBLE_RES tail, an
// extension and a JPG_PNG aspect-ratio token (`_9x16`) taken off, upper-cased,
// separators folded. Pairing on it is EXACT; anything close is only REPORTED
// as a near miss (one token apart, or a variant), never joined -- the rule
// every matcher in this toolbox keeps.
//
// Batches pair across trees LOOSELY (Batch_02 = Batch_2 = batch 2), the same
// rule as csvLocExistingBatchFolder, and a POST batch stays its own
// (Batch_2 never matches Batch_2_POST).
// =============================================================================
import { Result, decode } from "./shared";

function trLoose(n: string): string {
  return String(n).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|\D)0+(\d)/g, "$1$2");
}

function trKids(folder: Folder): any[] {
  try { return folder.getFiles() || []; } catch (e) { return []; }
}

function trIsFolder(x: any): boolean {
  return !!x && typeof x.getFiles === "function";
}

/** A child folder of `parent` whose name matches `batch` loosely, or null. */
function trBatchIn(parent: Folder, batch: string): Folder | null {
  const want = trLoose(batch);
  const kids = trKids(parent);
  for (let i = 0; i < kids.length; i++) {
    if (!trIsFolder(kids[i])) continue;
    const nm = decode(String(kids[i].name));
    if (nm.charAt(0) === "_") continue;
    if (trLoose(nm) === want) return kids[i] as Folder;
  }
  return null;
}

function trChild(parent: Folder, name: string): Folder | null {
  const kids = trKids(parent);
  for (let i = 0; i < kids.length; i++) {
    if (trIsFolder(kids[i]) && decode(String(kids[i].name)).toLowerCase() === name.toLowerCase()) return kids[i] as Folder;
  }
  return null;
}

/** The deliverable key -- see the header. */
export function trackerKey(name: string): string {
  let s = decode(String(name || ""));
  const dot = s.lastIndexOf(".");
  if (dot > 0 && s.length - dot <= 5) s = s.substring(0, dot);
  s = s.replace(/_[Vv]\d+_(?:DOUBLE|TRIPLE|QUAD)_RES$/i, "").replace(/_[Vv]\d+$/, "");
  const toks = s.split(/[_ ]+/);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i]) continue;
    if (/^\d{1,2}x\d{1,2}$/i.test(toks[i])) continue; // a JPG_PNG aspect ratio, redundant with the size
    out.push(toks[i].toUpperCase());
  }
  return out.join("_");
}

function trVersion(name: string): number {
  const n = decode(String(name));
  const m = /_[Vv](\d+)(?:_(?:DOUBLE|TRIPLE|QUAD)_RES)?(?:\.[^.]*)?$/i.exec(n);
  return m ? parseInt(m[1], 10) : 0;
}

interface TrFile { name: string; path: string; version: number }

export interface TrackerRow {
  key: string;
  /** The best display name we have (the project's, else the art's, else Wrike's). */
  name: string;
  art?: { path: string; files: number };
  aep?: TrFile & { versions: number };
  render?: TrFile & { versions: number; all: string[] };
  delivered?: { name: string; path: string };
  wrike?: { name: string; status: string };
  /** A name in another stage that NEARLY matches this one -- never joined. */
  near?: { stage: string; name: string; why: string }[];
}

interface TrackerResult extends Result {
  territory?: string;
  batch?: string;
  folders?: { art: string; aep: string; renders: string; delivered: string[]; specs: string };
  rows?: TrackerRow[];
}

/** One token apart (same count), with what differs said in words. */
function trNearWhy(a: string, b: string): string {
  const ta = a.split("_");
  const tb = b.split("_");
  if (ta.length === tb.length) {
    let at = -1;
    for (let i = 0; i < ta.length; i++) {
      if (ta[i] === tb[i]) continue;
      if (at !== -1) return "";
      at = i;
    }
    if (at === -1) return "";
    const x = ta[at], y = tb[at];
    if (/^\d+S(EC)?$/.test(x) && /^\d+S(EC)?$/.test(y)) return "length differs: " + x.toLowerCase() + " vs " + y.toLowerCase();
    if (/^\d+X\d+(PX)?$/.test(x) && /^\d+X\d+(PX)?$/.test(y)) return "size differs: " + x.toLowerCase() + " vs " + y.toLowerCase();
    return "differs: " + x + " vs " + y;
  }
  // The same name plus words -- a variant, not another deliverable.
  if (tb.length > ta.length && b.indexOf(a + "_") === 0) return "variant: " + tb.slice(ta.length).join(" ");
  if (ta.length > tb.length && a.indexOf(b + "_") === 0) return "variant: " + ta.slice(tb.length).join(" ");
  // SAME CREATIVE, SAME PIXEL SIZE, named differently. Norway's POST batch:
  // "…_Characters_DOOH_Post_1080x1920px_30s" in AE, "…_Characters_DOOH_Digital
  // MetroPOST_1080x1920px_10s" in JPG_PNG -- two tokens and a length apart, so
  // the one-token rule never saw it. Only ever asked of two ORPHANS (see the
  // caller), so two real deliverables of one size are never flagged.
  const size = (t: string[]) => { for (let i = 0; i < t.length; i++) if (/^\d{3,}X\d{3,}(PX)?$/.test(t[i])) return t[i].replace(/PX$/, ""); return ""; };
  const sa = size(ta), sb = size(tb);
  if (sa && sa === sb && ta.slice(0, 4).join("_") === tb.slice(0, 4).join("_")) {
    const la = (a.match(/_(\d+)S(?:EC)?(?:_|$)/) || [])[1], lb = (b.match(/_(\d+)S(?:EC)?(?:_|$)/) || [])[1];
    return "same size, named differently" + (la && lb && la !== lb ? " (and " + la + "s vs " + lb + "s)" : "");
  }
  return "";
}

/** Where the open project sits, if it is inside a markets tree. */
export const trackerContext = (): Result & { territoryPath?: string; territory?: string; batch?: string; batches?: string[]; projectPath?: string } => {
  try {
    const f = app.project.file;
    if (!f) return { success: true };
    let node: Folder | null = f.parent;
    let batch = "";
    let guard = 0;
    while (node && guard++ < 8) {
      const nm = decode(String(node.name));
      const parent = node.parent;
      if (parent && decode(String(parent.name)).toUpperCase() === "AE") {
        batch = nm;
        const terr = parent.parent;
        if (!terr) break;
        return { success: true, territoryPath: String(terr.fsName), territory: decode(String(terr.name)), batch: batch, batches: trackerBatchesRaw(terr), projectPath: String(f.fsName) };
      }
      node = parent;
    }
    return { success: true, projectPath: String(f.fsName) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

function trackerBatchesRaw(terr: Folder): string[] {
  const out: string[] = [];
  const ae = trChild(terr, "AE");
  if (!ae) return out;
  const kids = trKids(ae);
  for (let i = 0; i < kids.length; i++) {
    if (!trIsFolder(kids[i])) continue;
    const nm = decode(String(kids[i].name));
    if (nm.charAt(0) === "_") continue;
    out.push(nm);
  }
  out.sort();
  return out;
}

export const trackerBatches = (territoryPath: string): Result & { batches?: string[] } => {
  try {
    const terr = new Folder(territoryPath);
    // .exists on a DIRECTORY is the one case it's trusted on the NAS.
    if (!terr.exists) return { success: false, error: "That territory folder isn't reachable." };
    return { success: true, batches: trackerBatchesRaw(terr) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** A folder the user picks: a territory, or a batch inside its AE folder. */
export const trackerPickFolder = (): Result & { territoryPath?: string; batch?: string } => {
  try {
    const f = Folder.selectDialog("Pick a territory folder, or a batch inside its AE folder");
    if (!f) return { success: true };
    const parent = f.parent;
    if (parent && decode(String(parent.name)).toUpperCase() === "AE" && parent.parent) {
      return { success: true, territoryPath: String(parent.parent.fsName), batch: decode(String(f.name)) };
    }
    return { success: true, territoryPath: String(f.fsName) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * The batch, lined up by deliverable. `argsJson` (one JSON string, the bridge
 * rule): { territoryPath, batch, wrike?: [{ name, status }] }.
 */
export const trackerScan = (argsJson: string): TrackerResult => {
  try {
    let args: { territoryPath?: string; batch?: string; wrike?: { name: string; status: string }[] };
    try { args = JSON.parse(argsJson); } catch (e) { return { success: false, error: "Could not read the request." }; }
    const terr = new Folder(String(args.territoryPath || ""));
    if (!terr.exists) return { success: false, error: "That territory folder isn't reachable." };
    const batch = String(args.batch || "");
    if (!batch) return { success: false, error: "Pick a batch." };

    const rows: { [k: string]: TrackerRow } = {};
    const order: string[] = [];
    const row = (key: string, name: string): TrackerRow => {
      if (!rows[key]) { rows[key] = { key: key, name: name }; order.push(key); }
      return rows[key];
    };
    const folders = { art: "", aep: "", renders: "", delivered: [] as string[], specs: "" };
    const masters = trChild(terr, "Masters");
    const specs = masters ? trChild(masters, "Specs") : null;
    if (specs) folders.specs = String(specs.fsName);

    // AE: the projects.
    const ae = trChild(terr, "AE");
    const aeBatch = ae ? trBatchIn(ae, batch) : null;
    if (aeBatch) {
      folders.aep = String(aeBatch.fsName);
      const kids = trKids(aeBatch);
      for (let i = 0; i < kids.length; i++) {
        if (trIsFolder(kids[i])) continue;
        const nm = decode(String(kids[i].name));
        if (!/\.aep$/i.test(nm) || nm.charAt(0) === "_") continue;
        const r = row(trackerKey(nm), nm.replace(/_[Vv]\d+\.aep$/i, "").replace(/\.aep$/i, ""));
        const v = trVersion(nm);
        const n = r.aep ? r.aep.versions + 1 : 1;
        if (!r.aep || v > r.aep.version) r.aep = { name: nm, path: String(kids[i].fsName), version: v, versions: n };
        else r.aep.versions = n;
      }
    }

    // JPG_PNG: the artwork, one subfolder per deliverable.
    const jp = trChild(terr, "JPG_PNG");
    const jpBatch = jp ? trBatchIn(jp, batch) : null;
    if (jpBatch) {
      folders.art = String(jpBatch.fsName);
      const kids = trKids(jpBatch);
      for (let i = 0; i < kids.length; i++) {
        if (!trIsFolder(kids[i])) continue;
        const nm = decode(String(kids[i].name));
        if (nm.charAt(0) === "_") continue;
        let count = 0;
        const inner = trKids(kids[i] as Folder);
        for (let j = 0; j < inner.length; j++) if (!trIsFolder(inner[j]) && /\.(png|jpe?g|tiff?)$/i.test(decode(String(inner[j].name)))) count++;
        const r = row(trackerKey(nm), nm);
        r.art = { path: String(kids[i].fsName), files: count };
      }
    }

    // Renders: the MOVs, and what was delivered.
    const rd = trChild(terr, "Renders");
    const rdBatch = rd ? trBatchIn(rd, batch) : null;
    const deliveredIn: Folder[] = [];
    if (rdBatch) {
      folders.renders = String(rdBatch.fsName);
      const kids = trKids(rdBatch);
      for (let i = 0; i < kids.length; i++) {
        const nm = decode(String(kids[i].name));
        if (trIsFolder(kids[i])) {
          if (nm.toLowerCase() === "_delivery") deliveredIn.push(kids[i] as Folder);
          continue;
        }
        if (!/\.mov$/i.test(nm) || nm.charAt(0) === "_") continue;
        const r = row(trackerKey(nm), nm.replace(/(_[Vv]\d+)?(_(DOUBLE|TRIPLE|QUAD)_RES)?\.mov$/i, ""));
        const v = trVersion(nm);
        if (!r.render) r.render = { name: nm, path: String(kids[i].fsName), version: v, versions: 0, all: [] };
        r.render.versions++;
        r.render.all.push(String(kids[i].fsName));
        if (v > r.render.version) { r.render.name = nm; r.render.path = String(kids[i].fsName); r.render.version = v; }
      }
    }
    if (rd) {
      const dl = trChild(rd, "_Delivery");
      if (dl) deliveredIn.push(dl);
    }
    for (let d = 0; d < deliveredIn.length; d++) {
      folders.delivered.push(String(deliveredIn[d].fsName));
      const stack: Folder[] = [deliveredIn[d]];
      let depth = 0;
      while (stack.length && depth++ < 40) {
        const f = stack.pop() as Folder;
        const kids = trKids(f);
        for (let i = 0; i < kids.length; i++) {
          if (trIsFolder(kids[i])) { stack.push(kids[i] as Folder); continue; }
          const nm = decode(String(kids[i].name));
          if (!/\.(mp4|mov)$/i.test(nm)) continue;
          const k = trackerKey(nm);
          // Only a deliverable this batch already knows: _Delivery at the
          // Renders root holds every batch's files.
          if (rows[k] && !rows[k].delivered) rows[k].delivered = { name: nm, path: String(kids[i].fsName) };
        }
      }
    }

    // Wrike: the subtasks, if the panel sent them.
    const wr = args.wrike || [];
    for (let i = 0; i < wr.length; i++) {
      const r = row(trackerKey(wr[i].name), wr[i].name);
      r.wrike = { name: wr[i].name, status: String(wr[i].status || "") };
    }

    // NEAR MISSES: a row missing a stage whose neighbour HAS that stage under a
    // name one token away. Reported on both, joined on neither.
    const stages: { id: string; has: (r: TrackerRow) => boolean; label: string }[] = [
      { id: "art", has: (r) => !!r.art, label: "art (JPG_PNG)" },
      { id: "aep", has: (r) => !!r.aep, label: "project (AE)" },
      { id: "render", has: (r) => !!r.render, label: "render" },
      { id: "wrike", has: (r) => !!r.wrike, label: "Wrike subtask" },
    ];
    for (let a = 0; a < order.length; a++) {
      const ra = rows[order[a]];
      for (let b = 0; b < order.length; b++) {
        if (a === b) continue;
        const rb = rows[order[b]];
        // ORPHANS ONLY: each must hold a stage the other lacks. Two complete
        // deliverables of one size are two deliverables, not a mismatch.
        let aOnly = false;
        for (let s = 0; s < stages.length; s++) if (stages[s].has(ra) && !stages[s].has(rb)) aOnly = true;
        if (!aOnly) continue;
        for (let s = 0; s < stages.length; s++) {
          if (stages[s].has(ra) || !stages[s].has(rb)) continue;
          const why = trNearWhy(ra.key, rb.key);
          if (!why) continue;
          ra.near = ra.near || [];
          ra.near.push({ stage: stages[s].label, name: rb.name, why: why });
        }
      }
    }

    // Sorted by name, so a batch reads the same every time it is opened.
    order.sort();
    const out: TrackerRow[] = [];
    for (let i = 0; i < order.length; i++) out.push(rows[order[i]]);
    return { success: true, territory: decode(String(terr.name)), batch: batch, folders: folders, rows: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
