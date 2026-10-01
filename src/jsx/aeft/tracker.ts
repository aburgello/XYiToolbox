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
import { ownProjectFolder, territoryCheck } from "./tools";
import { loadLocLibCampaigns } from "./localise";

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
  /** The web-playable preview in Renders/<Batch>/_mp4 -- NEVER a delivery. */
  preview?: TrFile;
  wrike?: { name: string; status: string };
  /** A name in another stage that NEARLY matches this one -- never joined. */
  near?: { stage: string; name: string; why: string }[];
  /** A Wrike subtask whose files are on disk under another name -- see
   *  trSameDeliverable. The stages above are that disk row's; `name` is how
   *  the disk spells it, so the panel can offer to rename it to Wrike's. */
  claimed?: { name: string; why: string };
}

interface TrackerResult extends Result {
  territory?: string;
  batch?: string;
  folders?: { art: string; aep: string; renders: string; delivered: string[]; specs: string; pdfs: string };
  rows?: TrackerRow[];
}

/** One token apart (same count), with what differs said in words. */
function trNearWhy(a: string, b: string): string {
  const ta = a.split("_");
  const tb = b.split("_");
  // The same words in another order (Trio_POST_DOOH vs Trio_DOOH_POST): what
  // the art keeps after the project and render are renamed to Wrike's name.
  if (ta.length === tb.length && ta.slice().sort().join("_") === tb.slice().sort().join("_")) return "same words, another order";
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

/**
 * THE SAME DELIVERABLE, SPELLED TWO WAYS -- Wrike's subtask against a file on
 * disk. Only two shapes, both measured on Norway's POST batch:
 *
 *   the same words in another order   Trio_DOOH_POST  vs  Trio_POST_DOOH
 *   one word that contains the other  DOOH_POST       vs  DOOH_DigitalMetroPOST
 *
 * Size, length and market are never the word that differs (a size or length
 * apart is a different deliverable, which the near misses already say), and a
 * contained word must be three letters or more. The caller adds the rule that
 * makes this safe: it is used only when it is the ONE answer both ways.
 */
function trSameDeliverable(a: string, b: string): string {
  if (a === b) return "";
  const ta = a.split("_"), tb = b.split("_");
  if (ta.length !== tb.length) return "";
  const sa = ta.slice().sort().join("_"), sb = tb.slice().sort().join("_");
  if (sa === sb) return "same words, another order";
  let at = -1;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    if (at !== -1) return "";
    at = i;
  }
  if (at === -1) return "";
  const x = ta[at], y = tb[at];
  const fixed = /^\d+X\d+(PX)?$|^\d+S(EC)?$|^[A-Z]{2}$/;
  if (fixed.test(x) || fixed.test(y)) return "";
  const short = x.length <= y.length ? x : y, long = x.length <= y.length ? y : x;
  if (short.length < 3) return "";
  if (long.indexOf(short) === 0 || long.lastIndexOf(short) === long.length - short.length) return y + " vs " + x;
  return "";
}

/**
 * Every job chip's batch in ONE call (argsJson: [{ id, territoryPath, batch,
 * wrike }]), so the chips cost one trip to AE instead of one each -- and
 * reuse the listings trackerScan keeps. Each answer is exactly trackerScan's.
 */
export const trackerScanMany = (argsJson: string): Result & { results?: { [id: string]: any } } => {
  try {
    let list: { id: string; territoryPath: string; batch: string; wrike?: { name: string; status: string }[]; force?: boolean }[];
    try { list = JSON.parse(argsJson); } catch (e) { return { success: false, error: "Could not read the request." }; }
    const results: { [id: string]: any } = {};
    for (let i = 0; i < list.length; i++) {
      results[String(list[i].id)] = trackerScan(JSON.stringify(list[i]));
    }
    return { success: true, results: results };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

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
/**
 * WHAT'S ON DISK FOR ONE BATCH -- the folder listings and nothing else, so it
 * can be kept. Reading is the slow half of a scan (AE's getFiles on the NAS);
 * lining the listing up with Wrike is not. The page asks again whenever
 * Wrike's statuses change (a live read lands, a job chip summarises), so the
 * listing is kept TR_DISK_TTL and only the merge is redone; refresh passes
 * `force` for a real read. Plain data only, no File objects, so a kept one
 * can never go stale in AE's hands.
 */
interface TrEntry { nm: string; path: string }
interface TrDisk {
  folders: { art: string; aep: string; renders: string; delivered: string[]; specs: string; pdfs: string };
  aes: TrEntry[];
  /** Deliverable folders under JPG_PNG/<batch>, or under JPG_PNG itself. */
  art: (TrEntry & { files: number })[];
  artIsRoot: boolean;
  artRoot: string;
  renders: TrEntry[];
  delivered: TrEntry[];
  previews: TrEntry[];
}
const TR_DISK_TTL = 60 * 1000;
const trDiskCache: { [k: string]: { at: number; disk: TrDisk } } = {};
const trNow = () => new Date().getTime();

function trReadDisk(terr: Folder, batch: string): TrDisk {
  const disk: TrDisk = { folders: { art: "", aep: "", renders: "", delivered: [], specs: "", pdfs: "" }, aes: [], art: [], artIsRoot: false, artRoot: "", renders: [], delivered: [], previews: [] };
  const masters = trChild(terr, "Masters");
  const specs = masters ? trChild(masters, "Specs") : null;
  if (specs) disk.folders.specs = String(specs.fsName);
  // The territory's PDFs: named in the hand-off message (Message for Wrike).
  // THIS BATCH'S folder inside it when there is one (PDFs/Batch_2, paired
  // loosely like every other batch folder), else PDFs itself: some
  // territories keep the sheets loose.
  const pdfs = trChild(terr, "PDFs");
  if (pdfs) {
    const pdfBatch = trBatchIn(pdfs, batch);
    disk.folders.pdfs = String((pdfBatch || pdfs).fsName);
  }

  const ae = trChild(terr, "AE");
  const aeBatch = ae ? trBatchIn(ae, batch) : null;
  if (aeBatch) {
    disk.folders.aep = String(aeBatch.fsName);
    const kids = trKids(aeBatch);
    for (let i = 0; i < kids.length; i++) {
      if (trIsFolder(kids[i])) continue;
      const nm = decode(String(kids[i].name));
      if (!/\.aep$/i.test(nm) || nm.charAt(0) === "_") continue;
      disk.aes.push({ nm: nm, path: String(kids[i].fsName) });
    }
  }

  // JPG_PNG: under a batch folder, or -- no batch level (Panama) -- under
  // JPG_PNG itself; see the merge for why the root only ever attaches.
  const jp = trChild(terr, "JPG_PNG");
  const jpBatch = jp ? trBatchIn(jp, batch) : null;
  const artAt = jpBatch || jp;
  disk.artIsRoot = !jpBatch;
  if (jp) disk.artRoot = String(jp.fsName);
  if (artAt) {
    const kids = trKids(artAt);
    for (let i = 0; i < kids.length; i++) {
      if (!trIsFolder(kids[i])) continue;
      const nm = decode(String(kids[i].name));
      if (nm.charAt(0) === "_") continue;
      let count = 0;
      const inner = trKids(kids[i] as Folder);
      for (let j = 0; j < inner.length; j++) if (!trIsFolder(inner[j]) && /\.(png|jpe?g|tiff?)$/i.test(decode(String(inner[j].name)))) count++;
      disk.art.push({ nm: nm, path: String(kids[i].fsName), files: count });
    }
    if (jpBatch) disk.folders.art = String(jpBatch.fsName);
  }

  const rd = trChild(terr, "Renders");
  const rdBatch = rd ? trBatchIn(rd, batch) : null;
  const deliveredIn: Folder[] = [];
  const previewIn: Folder[] = [];
  if (rdBatch) {
    disk.folders.renders = String(rdBatch.fsName);
    const kids = trKids(rdBatch);
    for (let i = 0; i < kids.length; i++) {
      const nm = decode(String(kids[i].name));
      if (trIsFolder(kids[i])) {
        if (nm.toLowerCase() === "_delivery") deliveredIn.push(kids[i] as Folder);
        else if (nm.toLowerCase() === "_mp4") previewIn.push(kids[i] as Folder);
        continue;
      }
      if (!/\.mov$/i.test(nm) || nm.charAt(0) === "_") continue;
      disk.renders.push({ nm: nm, path: String(kids[i].fsName) });
    }
  }
  if (rd) {
    const dl = trChild(rd, "_Delivery");
    if (dl) deliveredIn.push(dl);
  }
  for (let d = 0; d < deliveredIn.length; d++) {
    disk.folders.delivered.push(String(deliveredIn[d].fsName));
    const stack: Folder[] = [deliveredIn[d]];
    let depth = 0;
    while (stack.length && depth++ < 40) {
      const f = stack.pop() as Folder;
      const kids = trKids(f);
      for (let i = 0; i < kids.length; i++) {
        if (trIsFolder(kids[i])) { stack.push(kids[i] as Folder); continue; }
        const nm = decode(String(kids[i].name));
        if (/\.(mp4|mov)$/i.test(nm)) disk.delivered.push({ nm: nm, path: String(kids[i].fsName) });
      }
    }
  }
  for (let d = 0; d < previewIn.length; d++) {
    const kids = trKids(previewIn[d]);
    for (let i = 0; i < kids.length; i++) {
      if (trIsFolder(kids[i])) continue;
      const nm = decode(String(kids[i].name));
      if (!/\.(mp4|m4v)$/i.test(nm) || nm.charAt(0) === "_" || nm.charAt(0) === ".") continue;
      disk.previews.push({ nm: nm, path: String(kids[i].fsName) });
    }
  }
  return disk;
}

export const trackerScan = (argsJson: string): TrackerResult & { took?: { disk: number; cached: boolean } } => {
  try {
    let args: { territoryPath?: string; batch?: string; wrike?: { name: string; status: string }[]; force?: boolean; disk?: TrDisk };
    try { args = JSON.parse(argsJson); } catch (e) { return { success: false, error: "Could not read the request." }; }
    const batch = String(args.batch || "");
    if (!batch) return { success: false, error: "Pick a batch." };
    const cacheKey = String(args.territoryPath || "") + "|" + trLoose(batch);
    const hit = trDiskCache[cacheKey];
    const t0 = trNow();
    let disk: TrDisk;
    let cached = false;
    let terr: Folder = new Folder(String(args.territoryPath || ""));
    // THE PANEL READ THE FOLDERS ITSELF (lib/trackerDisk.ts, a port of
    // trReadDisk): the listing arrives with the request and this engine lists
    // nothing -- the seconds a scan took were all here. Taken only when it is
    // whole; anything else falls through to the read below, as before.
    const given = args.disk;
    if (given && given.folders && given.aes instanceof Array && given.art instanceof Array && given.renders instanceof Array
        && given.delivered instanceof Array && given.previews instanceof Array && given.folders.delivered instanceof Array) {
      disk = given;
      trDiskCache[cacheKey] = { at: t0, disk: disk };
    } else if (!args.force && hit && t0 - hit.at < TR_DISK_TTL) {
      disk = hit.disk;
      cached = true;
    } else {
      if (!terr.exists) return { success: false, error: "That territory folder isn't reachable." };
      disk = trReadDisk(terr, batch);
      trDiskCache[cacheKey] = { at: trNow(), disk: disk };
    }
    const took = { disk: trNow() - t0, cached: cached };

    const rows: { [k: string]: TrackerRow } = {};
    const order: string[] = [];
    const row = (key: string, name: string): TrackerRow => {
      if (!rows[key]) { rows[key] = { key: key, name: name }; order.push(key); }
      return rows[key];
    };
    const folders = { art: disk.folders.art, aep: disk.folders.aep, renders: disk.folders.renders, delivered: disk.folders.delivered.slice(0), specs: disk.folders.specs, pdfs: disk.folders.pdfs };

    // AE: the projects.
    for (let i = 0; i < disk.aes.length; i++) {
      const nm = disk.aes[i].nm;
      const r = row(trackerKey(nm), nm.replace(/_[Vv]\d+\.aep$/i, "").replace(/\.aep$/i, ""));
      const v = trVersion(nm);
      const n = r.aep ? r.aep.versions + 1 : 1;
      if (!r.aep || v > r.aep.version) r.aep = { name: nm, path: disk.aes[i].path, version: v, versions: n };
      else r.aep.versions = n;
    }

    // JPG_PNG. Under a batch folder, every deliverable folder is a row. With
    // NO batch level (Street Fighter INT: Panama's JPG_PNG/<deliverable>/
    // beside AE/Batch_01, 2026-09-30) the root holds EVERY batch's art, so its
    // folders are only ATTACHED to deliverables this batch already has (from
    // AE or Wrike, after those are read below) and never add rows -- the same
    // structural rule as MC It!'s mcItDeriveImageFolder.
    const rootArt: { [k: string]: { path: string; files: number } } = {};
    for (let i = 0; i < disk.art.length; i++) {
      const a = disk.art[i];
      const art = { path: a.path, files: a.files };
      if (!disk.artIsRoot) row(trackerKey(a.nm), a.nm).art = art;
      else rootArt[trackerKey(a.nm)] = art;
    }

    // Renders: the MOVs.
    for (let i = 0; i < disk.renders.length; i++) {
      const nm = disk.renders[i].nm, path = disk.renders[i].path;
      const r = row(trackerKey(nm), nm.replace(/(_[Vv]\d+)?(_(DOUBLE|TRIPLE|QUAD)_RES)?\.mov$/i, ""));
      const v = trVersion(nm);
      if (!r.render) r.render = { name: nm, path: path, version: v, versions: 0, all: [] };
      r.render.versions++;
      r.render.all.push(path);
      if (v > r.render.version) { r.render.name = nm; r.render.path = path; r.render.version = v; }
    }

    // Delivered: only a deliverable this batch already knows -- _Delivery at
    // the Renders root holds every batch's files.
    for (let i = 0; i < disk.delivered.length; i++) {
      const k = trackerKey(disk.delivered[i].nm);
      if (rows[k] && !rows[k].delivered) rows[k].delivered = { name: disk.delivered[i].nm, path: disk.delivered[i].path };
    }

    // Previews: the studio renders a web-playable mp4 per deliverable into the
    // batch's _mp4 (2026-09-30). Only for deliverables this batch knows, the
    // newest version kept. Shown and played, never counted as delivered.
    for (let i = 0; i < disk.previews.length; i++) {
      const nm = disk.previews[i].nm;
      const r = rows[trackerKey(nm)];
      if (!r) continue;
      const v = trVersion(nm);
      if (!r.preview || v > r.preview.version) r.preview = { name: nm, path: disk.previews[i].path, version: v };
    }

    // Wrike: the subtasks, if the panel sent them.
    const wr = args.wrike || [];
    for (let i = 0; i < wr.length; i++) {
      const r = row(trackerKey(wr[i].name), wr[i].name);
      r.wrike = { name: wr[i].name, status: String(wr[i].status || "") };
    }

    // No batch level under JPG_PNG: attach the root's art to this batch's own
    // deliverables, and point the Art link at JPG_PNG only when any attached.
    let rootHits = 0;
    for (const k in rootArt) {
      if (!rootArt.hasOwnProperty(k) || !rows[k]) continue;
      rows[k].art = rootArt[k];
      rootHits++;
    }
    if (rootHits && disk.artRoot) folders.art = disk.artRoot;

    // CLAIMS: a Wrike subtask with nothing on disk takes the ONE disk row that
    // is the same deliverable spelled another way (trSameDeliverable) -- and
    // only when that disk row answers to no other subtask either. It is shown
    // as a problem with a rename, never as fine: Deliver and Review pair on
    // the exact name and will not find it until it is renamed.
    const hasDisk = (r: TrackerRow) => !!(r.art || r.aep || r.render || r.delivered);
    const wrikeOnly: string[] = [], diskOnly: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const r = rows[order[i]];
      if (r.wrike && !hasDisk(r)) wrikeOnly.push(order[i]);
      else if (!r.wrike && hasDisk(r)) diskOnly.push(order[i]);
    }
    const candidates = (k: string, pool: string[]) => {
      const out: string[] = [];
      for (let i = 0; i < pool.length; i++) if (trSameDeliverable(k, pool[i])) out.push(pool[i]);
      return out;
    };
    const claimed: { [k: string]: boolean } = {};
    for (let i = 0; i < wrikeOnly.length; i++) {
      const wk = wrikeOnly[i];
      const c = candidates(wk, diskOnly);
      if (c.length !== 1 || claimed[c[0]]) continue;
      if (candidates(c[0], wrikeOnly).length !== 1) continue;
      const w = rows[wk], d = rows[c[0]];
      w.art = d.art; w.aep = d.aep; w.render = d.render; w.delivered = d.delivered; w.preview = d.preview;
      w.claimed = { name: d.name, why: trSameDeliverable(wk, c[0]) };
      claimed[c[0]] = true;
    }
    for (let i = order.length - 1; i >= 0; i--) if (claimed[order[i]]) { delete rows[order[i]]; order.splice(i, 1); }

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
    return { success: true, territory: decode(String(terr.name)), batch: batch, folders: folders, rows: out, took: took };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * RENAME A DELIVERABLE'S FILES TO WRIKE'S NAME -- the tracker's one write.
 * `argsJson`: { territoryPath, batch, from, to, apply }. `from` is the stem as
 * the disk spells it, `to` the Wrike subtask. With apply false it only says
 * what it would do; the panel shows that in the confirm.
 *
 * What moves: every .aep version in AE/<Batch> and every .mov version in
 * Renders/<Batch>. NEVER JPG_PNG: the artwork is the mech team's, and the
 * studio doesn't touch it (decided 2026-09-30) -- a pairing that disagrees
 * with the art stays a near miss for a person to raise. Only files whose own
 * name starts with `from` -- the tail (_V02, _DOUBLE_RES, the extension) is
 * kept exactly. Nothing in
 * _Delivery, _Old or any `_` folder, never a name carrying an OV token (a
 * master is never renamed), and never inside a project: the comp keeps its
 * name until trackerRenameComp is run in it.
 *
 * ALL OR NOTHING UP FRONT: it refuses before touching anything when a new
 * name is already taken (read from the folder listing, never .exists on the
 * NAS) or when one of the projects is the one open in AE.
 */
export const trackerRename = (argsJson: string): Result & { plan?: { from: string; to: string; kind: string }[]; renamed?: number; failed?: string[] } => {
  try {
    let args: { territoryPath?: string; batch?: string; from?: string; to?: string; apply?: boolean };
    try { args = JSON.parse(argsJson); } catch (e) { return { success: false, error: "Could not read the request." }; }
    const from = String(args.from || ""), to = String(args.to || "");
    if (!from || !to) return { success: false, error: "Nothing to rename." };
    // "/" escaped even inside the class: ExtendScript ends a regex literal at
    // the first bare "/", class or not, and the whole bundle then fails to
    // parse (a SyntaxError on every panel open).
    if (/[\\\/:*?"<>|]/.test(to) || to.charAt(0) === "." || to.charAt(0) === "_") return { success: false, error: "Wrike's name can't be a filename: " + to };
    if (/(^|[_\s])OV([_\s.]|$)/i.test(from) || /(^|[_\s])OV([_\s.]|$)/i.test(to)) return { success: false, error: "That's an OV name -- masters are never renamed." };
    const terr = new Folder(String(args.territoryPath || ""));
    if (!terr.exists) return { success: false, error: "That territory folder isn't reachable." };
    const batch = String(args.batch || "");
    const fromU = from.toUpperCase();
    const startsWith = (nm: string) => nm.length > from.length ? nm.substring(0, from.length).toUpperCase() === fromU && /^[_. ]/.test(nm.charAt(from.length)) : nm.toUpperCase() === fromU;
    type Step = { item: any; parent: Folder; from: string; to: string; kind: string; order: number };
    const steps: Step[] = [];
    const add = (parent: Folder, item: any, kind: string, order: number) => {
      const nm = decode(String(item.name));
      if (!startsWith(nm)) return;
      steps.push({ item: item, parent: parent, from: nm, to: to + nm.substring(from.length), kind: kind, order: order });
    };
    const inBatch = (tree: string): Folder | null => { const t = trChild(terr, tree); return t ? trBatchIn(t, batch) : null; };

    const ae = inBatch("AE");
    if (ae) { const k = trKids(ae); for (let i = 0; i < k.length; i++) if (!trIsFolder(k[i]) && /\.aep$/i.test(decode(String(k[i].name)))) add(ae, k[i], "project", 1); }
    const rd = inBatch("Renders");
    if (rd) { const k = trKids(rd); for (let i = 0; i < k.length; i++) if (!trIsFolder(k[i]) && /\.mov$/i.test(decode(String(k[i].name)))) add(rd, k[i], "render", 1); }
    if (!steps.length) return { success: false, error: "Found nothing named " + from + " in this batch." };

    // Refusals, before anything moves.
    const open = app.project && app.project.file ? String(app.project.file.fsName) : "";
    for (let i = 0; i < steps.length; i++) {
      if (open && String(steps[i].item.fsName) === open) return { success: false, error: steps[i].from + " is open in AE. Close it, then rename." };
      const kids = trKids(steps[i].parent);
      for (let j = 0; j < kids.length; j++) {
        if (decode(String(kids[j].name)).toUpperCase() === steps[i].to.toUpperCase() && steps[i].to.toUpperCase() !== steps[i].from.toUpperCase()) {
          return { success: false, error: steps[i].to + " already exists -- nothing was renamed." };
        }
      }
    }
    const plan: { from: string; to: string; kind: string }[] = [];
    for (let i = 0; i < steps.length; i++) plan.push({ from: steps[i].from, to: steps[i].to, kind: steps[i].kind });
    if (!args.apply) return { success: true, plan: plan };

    // The tracker's own write: whatever it kept of this disk is now wrong.
    for (const k in trDiskCache) if (trDiskCache.hasOwnProperty(k)) delete trDiskCache[k];
    let renamed = 0;
    const failed: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      let ok = false;
      try { ok = !!steps[i].item.rename(steps[i].to); } catch (e) { ok = false; }
      if (ok) renamed++; else failed.push(steps[i].from);
    }
    return { success: failed.length === 0, plan: plan, renamed: renamed, failed: failed, error: failed.length ? "Couldn't rename " + failed.length + ": " + failed[0] : undefined };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** The open project's deliverable comp, if its name no longer matches the
 *  file's -- which is what a rename leaves behind. Comps in the project's OWN
 *  root-level Main folder only (never an imported project's). */
export const trackerCompCheck = (): Result & { comps?: string[]; want?: string } => {
  try {
    const f = app.project && app.project.file;
    if (!f) return { success: true };
    const main = ownProjectFolder(app.project, "Main");
    if (!main) return { success: true };
    const want = trackerKey(decode(String(f.name)));
    const comps: string[] = [];
    for (let i = 1; i <= main.numItems; i++) {
      const it: any = main.item(i);
      if (typeof it.layers === "undefined") continue;
      if (trackerKey(String(it.name)) !== want) comps.push(String(it.name));
    }
    return { success: true, comps: comps, want: decode(String(f.name)).replace(/\.aep$/i, "").replace(/_[Vv]\d+$/, "") };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Renames the open project's deliverable comps to the file's name, keeping
 *  each comp's own version and _DOUBLE_RES tail. Not saved: that is the
 *  artist's press, and Ctrl+Z undoes it. */
export const trackerRenameComp = (): Result & { renamed?: number } => {
  try {
    const f = app.project && app.project.file;
    if (!f) return { success: false, error: "Save this project once first." };
    const main = ownProjectFolder(app.project, "Main");
    if (!main) return { success: false, error: "This project has no Main folder." };
    const stemName = decode(String(f.name)).replace(/\.aep$/i, "").replace(/_[Vv]\d+$/, "");
    const want = trackerKey(stemName);
    let n = 0;
    app.beginUndoGroup("Rename comp to match file");
    try {
      for (let i = 1; i <= main.numItems; i++) {
        const it: any = main.item(i);
        if (typeof it.layers === "undefined") continue;
        const cur = String(it.name);
        if (trackerKey(cur) === want) continue;
        const tail = (/(_[Vv]\d+)?(_(DOUBLE|TRIPLE|QUAD)_RES)?$/i.exec(cur) || [""])[0];
        it.name = stemName + tail;
        n++;
      }
    } finally {
      app.endUndoGroup();
    }
    return { success: true, renamed: n };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * WHERE EACH OF MY WRIKE JOBS LIVES ON DISK, so the tracker can open a batch
 * from its job rather than from whatever project is open. `argsJson`:
 * [{ id, code, batch, prefix }] -- the job's territory code, its batch as the
 * title says it ("Batch_2_POST"), and the film prefix its subtasks start with
 * ("SF"). One call for all of them.
 *
 * The territory is found as Deliver finds it: every saved Localised Library
 * campaign's Markets root, a folder territoryCheck resolves to the same
 * country. Two campaigns can both hold a Norway, so the candidates are ranked:
 * one whose AE holds this batch beats one that doesn't, and a batch holding a
 * project named with the job's film prefix beats one that doesn't. The batch
 * returned is the DISK's spelling (Batch_02 for a title's "Batch 2") when the
 * AE folder exists, else the title's. Read-only; unmounted roots are skipped
 * silently.
 */
export const trackerLocate = (argsJson: string): Result & { jobs?: { id: string; territoryPath: string; territory: string; batch: string; batches: string[] }[] } => {
  try {
    let args: { id: string; code: string; batch: string; prefix?: string }[];
    try { args = JSON.parse(argsJson); } catch (e) { return { success: false, error: "Could not read the jobs." }; }
    const camps = loadLocLibCampaigns() || [];
    // Every territory folder under every mounted Markets root, resolved once.
    const terrs: { folder: Folder; name: string; country: string }[] = [];
    for (let c = 0; c < camps.length; c++) {
      if (!camps[c].marketsRoot) continue;
      const root = new Folder(camps[c].marketsRoot);
      if (!root.exists) continue; // a DIRECTORY: the one .exists the NAS answers honestly
      const kids = trKids(root);
      for (let i = 0; i < kids.length; i++) {
        if (!trIsFolder(kids[i])) continue;
        const nm = decode(String(kids[i].name));
        if (nm.charAt(0) === "_") continue;
        const country = territoryCheck(nm);
        if (country) terrs.push({ folder: kids[i] as Folder, name: nm, country: country });
      }
    }
    const out: { id: string; territoryPath: string; territory: string; batch: string; batches: string[] }[] = [];
    for (let j = 0; j < args.length; j++) {
      const want = territoryCheck(String(args[j].code || ""));
      if (!want) continue;
      const prefix = String(args[j].prefix || "").toUpperCase();
      let best: { folder: Folder; name: string } | null = null;
      let bestScore = -1;
      let bestBatch = "";
      for (let t = 0; t < terrs.length; t++) {
        if (terrs[t].country !== want) continue;
        let score = 0;
        let diskBatch = "";
        const ae = trChild(terrs[t].folder, "AE");
        const bf = ae ? trBatchIn(ae, String(args[j].batch || "")) : null;
        if (bf) { score += 2; diskBatch = decode(String(bf.name)); }
        // Whose film is it: a project named with the job's prefix, in this
        // batch or -- for a batch not started yet -- in any batch here.
        if (prefix && ae) {
          const pool: Folder[] = bf ? [bf] : [];
          if (!bf) { const bs = trKids(ae); for (let b = 0; b < bs.length; b++) if (trIsFolder(bs[b])) pool.push(bs[b] as Folder); }
          let hit = false;
          for (let p = 0; p < pool.length && !hit; p++) {
            const files = trKids(pool[p]);
            for (let f = 0; f < files.length; f++) {
              if (decode(String(files[f].name)).toUpperCase().indexOf(prefix + "_") === 0) { hit = true; break; }
            }
          }
          if (hit) score += 1;
        }
        if (score > bestScore) { bestScore = score; best = terrs[t]; bestBatch = diskBatch; }
      }
      if (!best) continue;
      out.push({ id: String(args[j].id), territoryPath: String(best.folder.fsName), territory: best.name, batch: bestBatch || String(args[j].batch || ""), batches: trackerBatchesRaw(best.folder) });
    }
    return { success: true, jobs: out };
  } catch (e) {
    return { success: false, error: e.toString() + (e.line ? " (line " + e.line + ")" : "") };
  }
};
