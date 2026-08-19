// =============================================================================
// src/jsx/aeft/artwork.ts
// -----------------------------------------------------------------------------
// WHICH TIFF THIS DELIVERABLE IS SUPPOSED TO BE USING.
//
// The mech pipeline writes a CSV beside every deliverable's JPG/PNG, listing
// the artwork that went into it -- an ART row for the tiff and a TT row for the
// tagline treatment. That CSV is the reference. Nothing checked it, so a comp
// built from the wrong art edit looked perfectly fine until somebody noticed by
// eye, mid-localise, with the render already made.
//
// MATCHED ON FILENAME, NEVER ON PATH, and that is the whole design decision.
// The CSV's FilePath records wherever the mech tool happened to link the file,
// and across one real campaign that meant Sweden, Australia, Italy, France,
// Czechia and the Philippines all pointing at Markets/Latvia -- static elements
// maintained by another team. The same tiff also exists twice inside the
// masters tree (Support/TRIO/Tiffs and Support/Motion_Components/TRIO/Tiffs).
// Comparing paths would report a mismatch on almost every row and be ignored
// within a day. The FILE NAME is the thing that identifies an art edit.
//
// WHERE OURS LIVE: Support/Motion_Components/<CREATIVE>/Tiffs. One folder per
// creative, so a Trio deliverable is offered Trio's tiffs and nothing else.
// =============================================================================
import { Result } from "./shared";

export interface ArtworkRow {
  /** "ART" or "TT", straight from the sheet. */
  type: string;
  /** The filename the CSV names, e.g. FID_INTL_Trio_96Sheet_RGB_OV.tif. */
  name: string;
  /** Where the CSV says it came from. Informational only -- see the header. */
  filePath: string;
  /** True when a file of this name is in the project already. */
  inProject: boolean;
}

export interface ArtworkCheckResult extends Result {
  /** The deliverable this was checked against, i.e. the project filename
   *  without its _V<n> suffix. */
  deliverable?: string;
  territory?: string;
  /** The CSV that was read, "" when none was found. */
  csvPath?: string;
  rows?: ArtworkRow[];
  /** Every tiff in this creative's own folder, for picking a replacement. */
  creative?: string;
  tiffFolder?: string;
  tiffs?: { name: string; path: string }[];
  /** Tiffs in the project that the CSV does not mention. The likeliest shape
   *  of "wrong art edit": the right one absent and another one present. */
  unexpected?: string[];
  /** Said plainly rather than left for the panel to infer. */
  verdict?: "match" | "mismatch" | "no-reference";
}

/** Lowercase, extension dropped, separators removed. Identity is what survives. */
function artNorm(name: string): string {
  let s = String(name || "");
  const dot = s.lastIndexOf(".");
  if (dot > 0) s = s.substring(0, dot);
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A project filename without its version tail, e.g. "..._AU_V01" -> "..._AU". */
function stripVersion(name: string): string {
  let s = String(name || "");
  if (s.length > 4 && s.substring(s.length - 4).toLowerCase() === ".aep") {
    s = s.substring(0, s.length - 4);
  }
  // indexOf-driven rather than .match(): a deliverable name is not a regex and
  // real ones carry ( + [.
  const parts = s.split("_");
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length >= 2 && (last.charAt(0) === "V" || last.charAt(0) === "v")) {
      let digits = true;
      for (let i = 1; i < last.length; i++) {
        if ("0123456789".indexOf(last.charAt(i)) === -1) { digits = false; break; }
      }
      if (digits) parts.length = parts.length - 1;
    }
  }
  return parts.join("_");
}

/**
 * The CSV for `deliverable`, searched by NAME across every batch.
 *
 * Not built from the batch in the project's own path, because the two trees
 * disagree: AE writes Batch_01 and JPG_PNG writes Batch_1, and a deliverable
 * can be re-batched without being renamed. The name is the stable key.
 */
function findArtworkCsv(territoryRoot: Folder, deliverable: string): File | null {
  const jpgPng = new Folder(territoryRoot.fsName + "/JPG_PNG");
  if (!jpgPng.exists) return null;

  const batches = jpgPng.getFiles();
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b] as Folder;
    if (typeof batch.getFiles !== "function") continue;
    if (String(batch.name).charAt(0) === "_") continue;   // _Old, _Delivered

    const entries = batch.getFiles();
    for (let e = 0; e < entries.length; e++) {
      const entry = entries[e] as Folder;
      if (typeof entry.getFiles !== "function") continue;
      if (artNorm(entry.name) !== artNorm(deliverable)) continue;

      // No mask, then compare by hand -- getFiles("*.csv") is unreliable on
      // the studio's NAS (CLAUDE.md).
      const inner = entry.getFiles();
      for (let i = 0; i < inner.length; i++) {
        const f = inner[i] as File;
        if (typeof (f as any).getFiles === "function") continue;
        const n = String(f.name).toLowerCase();
        if (n.length > 4 && n.substring(n.length - 4) === ".csv") return f;
      }
    }
  }
  return null;
}

/** One CSV line into fields, honouring the quotes the mech tool writes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Every footage filename in the project, normalised. */
function projectFootageNames(): { norm: string; name: string }[] {
  const out: { norm: string; name: string }[] = [];
  const proj = app.project;
  for (let i = 1; i <= proj.numItems; i++) {
    const item = proj.item(i);
    // Duck-typed: footage is the thing with a `file`. instanceof against an AE
    // host class is banned (CLAUDE.md section 2).
    const f = (item as any).file;
    if (f && f.name) out.push({ norm: artNorm(f.name), name: String(f.name) });
  }
  return out;
}

/** The creative folder under Motion_Components whose name is in `deliverable`. */
function findCreativeFolder(mastersRoot: Folder, deliverable: string): Folder | null {
  const mc = new Folder(mastersRoot.fsName + "/Support/Motion_Components");
  if (!mc.exists) return null;
  const want = artNorm(deliverable);

  const kids = mc.getFiles();
  let best: Folder | null = null;
  let bestLen = 0;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i] as Folder;
    if (typeof k.getFiles !== "function") continue;
    if (String(k.name).charAt(0) === "_") continue;
    const n = artNorm(k.name);
    // LONGEST match wins: PORTAL_TO_PARADISE and PORTAL_LOS both start with
    // "portal", and picking the shorter one would offer the wrong creative's
    // art edits with no sign anything was wrong.
    if (n && want.indexOf(n) !== -1 && n.length > bestLen) { best = k; bestLen = n.length; }
  }
  return best;
}

/**
 * Checks the OPEN project against the CSV the mech pipeline wrote for it.
 *
 * Answers one question -- "which tiff am I supposed to be using here?" -- and
 * then says whether it is actually in the project. No reference is its own
 * answer, and a distinct one: it usually means the comp has been renamed away
 * from the deliverable the mech was built for (a duration corrected from 10s to
 * 7s, say), not that the artwork is wrong.
 */
export const artworkCheck = (): ArtworkCheckResult => {
  try {
    const proj = app.project;
    if (!proj.file) {
      return { success: false, error: "Save this project first — the reference is found from where it sits." };
    }

    const projFile = proj.file;
    const deliverable = stripVersion(projFile.name);

    // .../Markets/<Territory>/AE/<Batch>/<file>.aep -- so the territory root is
    // three levels up. Walked rather than assumed: a project saved somewhere
    // unexpected should say so instead of reading a stranger's folder.
    let territoryRoot: Folder | null = null;
    let cursor: Folder | null = projFile.parent;
    for (let hops = 0; hops < 6 && cursor; hops++) {
      const maybe = new Folder(cursor.fsName + "/JPG_PNG");
      if (maybe.exists) { territoryRoot = cursor; break; }
      cursor = cursor.parent;
    }
    if (!territoryRoot) {
      return {
        success: false,
        error: "Couldn't find a JPG_PNG folder above this project — is it saved inside a territory?",
      };
    }
    const territory = String(territoryRoot.name);

    // The masters tree is the sibling campaign folder. Derived from the CSV's
    // own ART path where possible, and only guessed at as a fallback -- see
    // below.
    const csv = findArtworkCsv(territoryRoot, deliverable);

    const rows: ArtworkRow[] = [];
    let csvPath = "";
    let mastersHint = "";
    if (csv) {
      csvPath = csv.fsName;
      if (csv.open("r")) {
        try {
          let header = true;
          while (!csv.eof) {
            const line = csv.readln();
            if (header) { header = false; continue; }
            if (!line || line.replace(/^\s+|\s+$/g, "") === "") continue;
            const cells = splitCsvLine(line);
            // PageLabel, Type, Name, FilePath, ...
            if (cells.length < 4) continue;
            const type = String(cells[1]).replace(/^\s+|\s+$/g, "");
            const name = String(cells[2]).replace(/^\s+|\s+$/g, "");
            const filePath = String(cells[3]).replace(/^\s+|\s+$/g, "");
            if (!name) continue;
            rows.push({ type: type, name: name, filePath: filePath, inProject: false });
            if (!mastersHint && filePath.indexOf("_Masters/") !== -1) {
              mastersHint = filePath.substring(0, filePath.indexOf("_Masters/") + 8);
            }
          }
        } finally {
          csv.close();
        }
      }
    }

    // --- what the project actually holds -----------------------------------
    const footage = projectFootageNames();
    const expected: { [norm: string]: boolean } = {};
    for (let r = 0; r < rows.length; r++) {
      const want = artNorm(rows[r].name);
      expected[want] = true;
      for (let f = 0; f < footage.length; f++) {
        if (footage[f].norm === want) { rows[r].inProject = true; break; }
      }
    }

    // Tiffs present that the sheet never mentions -- the other half of "wrong
    // art edit", and the half that names the culprit.
    const unexpected: string[] = [];
    for (let f = 0; f < footage.length; f++) {
      const n = footage[f].name.toLowerCase();
      const isTiff = n.length > 4 &&
        (n.substring(n.length - 4) === ".tif" || n.substring(n.length - 5) === ".tiff");
      if (!isTiff) continue;
      if (expected[footage[f].norm]) continue;
      if (unexpected.indexOf(footage[f].name) === -1) unexpected.push(footage[f].name);
    }

    // --- this creative's own art edits, for picking a replacement ------------
    let creative = "";
    let tiffFolder = "";
    const tiffs: { name: string; path: string }[] = [];
    if (mastersHint) {
      const mastersRoot = new Folder(mastersHint);
      const creativeFolder = findCreativeFolder(mastersRoot, deliverable);
      if (creativeFolder) {
        creative = String(creativeFolder.name);
        const tf = new Folder(creativeFolder.fsName + "/Tiffs");
        if (tf.exists) {
          tiffFolder = tf.fsName;
          const files = tf.getFiles();
          for (let i = 0; i < files.length; i++) {
            const f = files[i] as File;
            if (typeof (f as any).getFiles === "function") continue;
            const n = String(f.name).toLowerCase();
            if (n.length > 4 && (n.substring(n.length - 4) === ".tif" || n.substring(n.length - 5) === ".tiff")) {
              tiffs.push({ name: String(f.name), path: f.fsName });
            }
          }
        }
      }
    }

    let verdict: "match" | "mismatch" | "no-reference" = "no-reference";
    if (rows.length) {
      let allPresent = true;
      for (let r = 0; r < rows.length; r++) if (!rows[r].inProject) allPresent = false;
      verdict = allPresent ? "match" : "mismatch";
    }

    return {
      success: true,
      deliverable: deliverable,
      territory: territory,
      csvPath: csvPath,
      rows: rows,
      creative: creative,
      tiffFolder: tiffFolder,
      tiffs: tiffs,
      unexpected: unexpected,
      verdict: verdict,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Imports one tiff into the open project. It does NOT place it in a comp.
 *
 * Swapping the art edit is a judgement about layer order, masking and scale
 * that belongs to the artist. Bringing the right file in is the tedious part
 * and the part that can be got wrong by hand; putting it in the right place is
 * the part worth looking at.
 */
export const artworkImportTiff = (tiffPath: string): Result & { name?: string } => {
  try {
    const path = String(tiffPath || "").replace(/^\s+|\s+$/g, "");
    if (!path) return { success: false, error: "No file given." };
    const file = new File(path);
    // Attempted rather than tested with .exists: on the studio's NAS that
    // returns false for files that are plainly there (CLAUDE.md).
    app.beginUndoGroup("Import artwork");
    try {
      const io = new ImportOptions(file);
      const item = app.project.importFile(io);
      return { success: true, name: item ? String(item.name) : String(file.name) };
    } finally {
      app.endUndoGroup();
    }
  } catch (e) {
    return { success: false, error: "Couldn't import that file: " + e.toString() };
  }
};
