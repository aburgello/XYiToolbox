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
  /** True when this edit is in the project already. */
  inProject: boolean;
  /** The .aep motion edit built from this tiff, "" when the folder has none.
   *  Quad is a real example: a tiff with no animated version. */
  editName?: string;
  editPath?: string;
  /** Other edits whose name extends this one -- "_10" and the like. Offered,
   *  never chosen: which one a deliverable wants is a judgement about its
   *  duration and the artist has it. */
  editVariants?: ArtworkEdit[];
}

/** One .aep motion edit, and which of the creative's folders it came out of. */
export interface ArtworkEdit {
  name: string;
  path: string;
  /** "Tiffs", "TIFFs" or "Edit", as spelled on disk. Carried through to the
   *  panel because the two mean different things to an artist: a Tiffs edit is
   *  the animated version of one piece of artwork, an Edit is a cut of the
   *  whole thing. */
  folder: string;
}

export interface ArtworkCheckResult extends Result {
  /** The deliverable this was checked against, i.e. the project filename
   *  without its _V<n> suffix. */
  deliverable?: string;
  territory?: string;
  /** The CSV that was read, "" when none was found. */
  csvPath?: string;
  rows?: ArtworkRow[];
  /** Every MOTION EDIT (.aep) in this creative's own folder. The CSV names the
   *  static tiff the mech was composited from; what a motion deliverable needs
   *  is the animated edit built from it. */
  creative?: string;
  /** Every art folder that was read, e.g. "Tiffs" and "Edit". */
  editsFolder?: string;
  editFolders?: string[];
  edits?: ArtworkEdit[];
  /** The Motion_Components folder in play, and whether a person chose it. */
  componentsFolder?: string;
  componentsPicked?: boolean;
  /** Tiffs in the project that the CSV does not mention. The likeliest shape
   *  of "wrong art edit": the right one absent and another one present. */
  unexpected?: string[];
  /** Said plainly rather than left for the panel to infer. */
  verdict?: "match" | "mismatch" | "no-reference";
  /** The JPG_PNG folder that was actually searched, and whether a person
   *  chose it rather than the walk-up finding it. */
  jpgPngFolder?: string;
  picked?: boolean;
  /** On failure: this one is answerable by pointing at the folder, so the
   *  panel offers that instead of a dead end. */
  needsFolder?: boolean;
}

// Latin-1 Supplement (C0-FF) and Latin Extended-A (100-17F) folded to ASCII.
// Written as position-indexed ASCII tables rather than accented literals: these
// strings are spliced into eval'd ExtendScript source over the bridge, and
// non-ASCII in that path is exactly the sort of thing that arrives mangled.
// "?" means "no sensible base letter", which the a-z0-9 filter drops anyway.
var FOLD_C0 = "AAAAAAACEEEEIIIIDNOOOOO?OUUUUYPsaaaaaaaceeeeiiiidnooooo?ouuuuypy";
var FOLD_A = "AaAaAaCcCcCcCcDdDdEeEeEeEeEeGgGgGgGgHhHhIiIiIiIiIiIiJjKkkLlLlLlLlLlNnNnNnnNnOoOoOoOoRrRrRrSsSsSsSsTtTtTtUuUuUuUuUuUuWwYyYZzZzZzs";

/**
 * A file or folder name as a HUMAN would read it.
 *
 * `File.name` and `Folder.name` are the name portion of a URI, so anything
 * outside ASCII arrives percent-escaped:
 *
 *   name        FID_..._BioRexSeina%CC%88joki_624x1040px_10s_FI
 *   displayName FID_..._BioRexSeinajoki_624x1040px_10s_FI   (with the umlaut)
 *
 * Normalising that raw form is silently catastrophic, because stripping the
 * punctuation KEEPS the hex: the key grows a literal "cc88" in the middle and
 * matches nothing. Finland's BioRexSeinajoki went unfound for exactly this
 * reason, and Czechia, Poland and Serbia are all one accented site name away
 * from the same bug.
 */
function decodeName(name: string): string {
  const s = String(name || "");
  if (s.indexOf("%") === -1) return s;
  // File.decode is ExtendScript's own, and does not throw on a stray %.
  try {
    if (typeof File !== "undefined" && typeof (File as any).decode === "function") {
      return String((File as any).decode(s));
    }
  } catch (e) { /* fall through */ }
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

/**
 * Accented letters folded to their ASCII base, so both spellings of one name
 * key the same.
 *
 * Needed on top of decoding because macOS stores the mark SEPARATELY (a + U+0308)
 * while a Windows machine or a copy through another tool writes the single
 * character U+00E4. Decoded, the first already reads as "a" once the mark is
 * stripped; the second would vanish entirely and turn Seinajoki into Seinjoki.
 */
function foldAccents(name: string): string {
  let out = "";
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) { out += s.charAt(i); continue; }
    if (c >= 0x0300 && c <= 0x036f) continue;              // combining marks
    if (c >= 0x00c0 && c <= 0x00ff) { out += FOLD_C0.charAt(c - 0x00c0); continue; }
    if (c >= 0x0100 && c <= 0x017f) { out += FOLD_A.charAt(c - 0x0100); continue; }
    out += s.charAt(i);   // dropped by the a-z0-9 filter below
  }
  return out;
}

/** Lowercase, extension dropped, separators removed. Identity is what survives. */
function artNorm(name: string): string {
  let s = foldAccents(decodeName(name));
  const dot = s.lastIndexOf(".");
  if (dot > 0) s = s.substring(0, dot);
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True for a ratio token -- 9x16, 16x9, 4x5 -- and false for a SIZE. Both
 *  numbers being two digits or fewer is the whole test: real pixel sizes are
 *  three digits and up, so 1080x1920 is never mistaken for a ratio. */
function isRatioToken(t: string): boolean {
  const x = t.indexOf("x");
  if (x <= 0) return false;
  if (x === t.length - 1) return false;
  const a = t.substring(0, x);
  const b = t.substring(x + 1);
  if (a.length > 2 || b.length > 2) return false;
  for (let i = 0; i < t.length; i++) {
    if (i === x) continue;
    if ("0123456789".indexOf(t.charAt(i)) === -1) return false;
  }
  return true;
}

/**
 * The key that pairs a DELIVERABLE to its mech sheet.
 *
 * Not artNorm, because the two sides genuinely disagree on one token: JPG_PNG
 * writes the aspect ratio and AE does not.
 *
 *   AE      FID_INTL_Trio_DOOH_Metrobus_1080x1920px_10s_FR.aep
 *   JPG_PNG FID_INTL_Trio_DOOH_METROBUS _9x16_1080x1920px_10s_FR.csv
 *
 * Dropping it is safe rather than fuzzy: the ratio is REDUNDANT with the pixel
 * size sitting next to it, so two deliverables can never differ by ratio alone
 * -- 1080x1920 is 9x16 and nothing else. Every other token still has to match
 * exactly, which is what keeps 30_Sheet, 48_Sheet and 96Sheet apart.
 */
function deliverableKey(name: string): string {
  let s = foldAccents(decodeName(name));
  const dot = s.lastIndexOf(".");
  if (dot > 0) s = s.substring(0, dot);
  // Tokenised BEFORE separators are dropped -- "9x16" is only recognisable
  // while it is still a token of its own.
  const tokens = s.toLowerCase().split(/[^a-z0-9]+/);
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    if (isRatioToken(tokens[i])) continue;
    out += tokens[i];
  }
  return out;
}

/**
 * The key that pairs a TIFF to its MOTION EDIT.
 *
 * They are supposed to share a name and do not quite: the real folder holds
 * FID_INTL_Trio_96Sheet_RGB_OV.tif beside FID_INTL_Trio_96_Sheet_sRGB_OV.aep --
 * a separator that moved and an sRGB that grew an s. Dropping separators
 * handles the first; collapsing srgb to rgb handles the second. Both are
 * spelling, neither changes which art edit is meant.
 *
 * Anything looser would start matching different edits to each other, which is
 * the failure that matters here: 30_Sheet, 48_Sheet and 96Sheet are three
 * different pieces of artwork whose names differ by two characters.
 */
function editKey(name: string): string {
  return artNorm(name).replace(/srgb/g, "rgb");
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

/** The first .csv sitting directly inside `folder`. */
function firstCsvIn(folder: Folder): File | null {
  // No mask, then compare by hand -- getFiles("*.csv") is unreliable on the
  // studio's NAS (CLAUDE.md).
  const inner = folder.getFiles();
  for (let i = 0; i < inner.length; i++) {
    const f = inner[i] as File;
    if (typeof (f as any).getFiles === "function") continue;
    const n = String(f.name).toLowerCase();
    if (n.length > 4 && n.substring(n.length - 4) === ".csv") return f;
  }
  return null;
}

/**
 * The CSV for `deliverable`, searched by NAME under `root`.
 *
 * Not built from the batch in the project's own path, because the two trees
 * disagree: AE writes Batch_01 and JPG_PNG writes Batch_1, and a deliverable
 * can be re-batched without being renamed. The name is the stable key.
 *
 * Depth-limited and NAME-KEYED at every rung, so `root` can be any of the
 * folders a person might reasonably hand it: JPG_PNG itself, one batch inside
 * it, or the deliverable's own folder. Nothing here is fuzzy -- a folder or a
 * sheet is this deliverable's or it is not. A wrong sheet would report the
 * wrong art edit with total confidence, which is worse than finding nothing.
 */
function findArtworkCsvUnder(root: Folder, deliverable: string, depth: number): File | null {
  const want = deliverableKey(deliverable);

  // `root` may BE the deliverable's folder -- true when somebody picks it.
  if (deliverableKey(root.name) === want) {
    const here = firstCsvIn(root);
    if (here) return here;
  }

  const entries = root.getFiles();

  // A sheet named for the deliverable, sitting loose beside its siblings.
  for (let i = 0; i < entries.length; i++) {
    const f = entries[i] as File;
    if (typeof (f as any).getFiles === "function") continue;
    const n = String(f.name).toLowerCase();
    if (n.length <= 4 || n.substring(n.length - 4) !== ".csv") continue;
    if (deliverableKey(f.name) === want) return f;
  }

  if (depth <= 0) return null;

  for (let i = 0; i < entries.length; i++) {
    const k = entries[i] as Folder;
    if (typeof k.getFiles !== "function") continue;
    if (String(k.name).charAt(0) === "_") continue;   // _Old, _Delivered
    const hit = findArtworkCsvUnder(k, deliverable, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * What a manually picked folder means.
 *
 * Deliberately forgiving about WHICH rung was picked, because "the JPG_PNG
 * folder" is only ever asked for when the automatic walk already failed, and
 * failing a second time over which folder somebody clicked would be its own
 * small insult. The territory root, JPG_PNG itself, a batch and a deliverable
 * folder all resolve; the name-keyed search below is what keeps that safe.
 */
function resolvePickedJpgPng(path: string): { folder: Folder; territory: string } | null {
  const picked = new Folder(path);
  // .exists is only trustworthy on a DIRECTORY, and this is one (CLAUDE.md).
  if (!picked.exists) return null;

  if (artNorm(picked.name) === "jpgpng") {
    const parent = picked.parent;
    return { folder: picked, territory: parent ? String(parent.name) : String(picked.name) };
  }
  const inside = new Folder(picked.fsName + "/JPG_PNG");
  if (inside.exists) return { folder: inside, territory: String(picked.name) };

  // A batch, or the deliverable's own folder. Searched as given -- but the
  // TERRITORY is still worth having, so walk up for whoever JPG_PNG belongs to
  // rather than heading the report "Batch_1".
  let territory = String(picked.name);
  let cursor: Folder | null = picked.parent;
  for (let hops = 0; hops < 4 && cursor; hops++) {
    const maybe = new Folder(cursor.fsName + "/JPG_PNG");
    if (maybe.exists) { territory = String(cursor.name); break; }
    cursor = cursor.parent;
  }
  return { folder: picked, territory: territory };
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

/**
 * Everything in the project that could BE an art edit: footage filenames and
 * COMP names both.
 *
 * A motion edit is imported as a project, so it arrives as a tree of comps and
 * there is no single file to look for. Only checking footage would report every
 * correctly built deliverable as missing its artwork.
 */
function projectItemNames(): { key: string; name: string; kind: string }[] {
  const out: { key: string; name: string; kind: string }[] = [];
  const proj = app.project;
  for (let i = 1; i <= proj.numItems; i++) {
    const item = proj.item(i);
    // Duck-typed: footage is the thing with a `file`, a comp the thing that can
    // count its layers. instanceof against an AE host class is banned
    // (CLAUDE.md section 2).
    const f = (item as any).file;
    if (f && f.name) {
      out.push({ key: editKey(f.name), name: String(f.name), kind: "footage" });
      continue;
    }
    if (typeof (item as any).numLayers === "number") {
      out.push({ key: editKey(item.name), name: String(item.name), kind: "comp" });
    }
  }
  return out;
}

/** The folders inside a creative that hold ART EDITS, as spelled on disk.
 *  Compared lowercased: TRIO writes "Tiffs", InternationalPayoff "TIFFs". */
function isArtEditFolder(name: string): boolean {
  const n = String(name || "").toLowerCase();
  if (n === "tiffs") return true;
  if (n === "tiff") return true;
  if (n === "edit") return true;
  if (n === "edits") return true;
  return false;
}

/**
 * The creative folder under `mc` whose name is in `deliverable`.
 */
function findCreativeFolder(mc: Folder, deliverable: string): Folder | null {
  if (!mc.exists) return null;
  const want = deliverableKey(deliverable);

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

/** Every .aep sitting directly in `folder`, tagged with the folder's name. */
function editsIn(folder: Folder, label: string, out: ArtworkEdit[]): void {
  const files = folder.getFiles();
  for (let i = 0; i < files.length; i++) {
    const f = files[i] as File;
    // Skips _Archive and Adobe After Effects Auto-Save for free: only files
    // sitting DIRECTLY in the folder are read.
    if (typeof (f as any).getFiles === "function") continue;
    const n = String(f.name).toLowerCase();
    // THE .aep, NOT THE .tif. Tiffs holds both: the static art the mech was
    // composited from, and the animated edit built from it. A motion
    // deliverable wants the second, and importing the first is what this got
    // wrong first time round.
    if (n.length > 4 && n.substring(n.length - 4) === ".aep") {
      out.push({ name: String(f.name), path: f.fsName, folder: label });
    }
  }
}

/**
 * Every art edit a creative has, across BOTH the folders it might keep them in.
 *
 * The two are not interchangeable and the panel says which is which. `Tiffs`
 * holds one .aep per piece of artwork, named after the tiff, so the sheet's ART
 * row pairs to it. `Edit` holds cuts of the whole spot -- FID_PORTALTOPARADISE
 * _EDIT_10sec -- whose names pair to nothing on the sheet by design. Which of
 * those a deliverable wants is the artist's call, so both are offered.
 *
 * Not every creative has either: BRACELET and PORTAL_LOS have neither folder,
 * InternationalPayoff has an empty TIFFs. An empty list is a normal answer.
 */
function collectEdits(creativeFolder: Folder): { edits: ArtworkEdit[]; folders: string[] } {
  const edits: ArtworkEdit[] = [];
  const folders: string[] = [];
  const kids = creativeFolder.getFiles();
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i] as Folder;
    if (typeof k.getFiles !== "function") continue;
    if (String(k.name).charAt(0) === "_") continue;   // _Old inside Edit
    if (!isArtEditFolder(k.name)) continue;
    folders.push(String(k.name));
    editsIn(k, String(k.name), edits);
  }
  return { edits: edits, folders: folders };
}

/**
 * The campaign's Motion_Components folder.
 *
 * THE MASTERS TREE IS A SIBLING CAMPAIGN, not a folder inside this one:
 * XY026040_..._Markets holds the territories, XY026039_..._Masters holds
 * Support/Motion_Components. So the walk goes up from the territory and looks
 * ACROSS at each level's siblings, testing for the folder itself rather than
 * pattern-matching a campaign name -- job numbers and the "_Masters" suffix are
 * both conventions this has already seen broken.
 */
function findMotionComponents(territoryRoot: Folder, mastersHint: string): Folder | null {
  // The CSV's own ART path, when it carries a _Masters/ segment. Kept because
  // campaigns laid out that way are still live.
  if (mastersHint) {
    const hinted = new Folder(mastersHint + "/Support/Motion_Components");
    if (hinted.exists) return hinted;
  }

  let cursor: Folder | null = territoryRoot;
  for (let hops = 0; hops < 4 && cursor; hops++) {
    const direct = new Folder(cursor.fsName + "/Support/Motion_Components");
    if (direct.exists) return direct;

    const parent: Folder | null = cursor.parent;
    if (!parent) break;

    const kids = parent.getFiles();
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i] as Folder;
      if (typeof k.getFiles !== "function") continue;
      if (String(k.name).charAt(0) === "_") continue;
      const mc = new Folder(k.fsName + "/Support/Motion_Components");
      if (mc.exists) return mc;
    }
    cursor = parent;
  }
  return null;
}

/**
 * What a manually picked components folder means.
 *
 * Same forgiveness as the JPG_PNG picker: Motion_Components itself, one
 * creative inside it, or a Tiffs/Edit folder directly all resolve. Picking the
 * art folder itself is the case that matters, because it is the only way to
 * reach a creative this cannot name from the deliverable.
 */
function resolvePickedComponents(path: string, deliverable: string):
  { creative: string; edits: ArtworkEdit[]; folders: string[] } | null {
  const picked = new Folder(path);
  if (!picked.exists) return null;

  // An art folder, picked directly.
  if (isArtEditFolder(picked.name)) {
    const edits: ArtworkEdit[] = [];
    editsIn(picked, String(picked.name), edits);
    const parent = picked.parent;
    return { creative: parent ? String(parent.name) : String(picked.name), edits: edits, folders: [String(picked.name)] };
  }

  // A creative folder: it has a Tiffs or an Edit inside.
  const own = collectEdits(picked);
  if (own.folders.length) {
    return { creative: String(picked.name), edits: own.edits, folders: own.folders };
  }

  // Motion_Components itself, or something above it.
  let mc: Folder = picked;
  const inner = new Folder(picked.fsName + "/Support/Motion_Components");
  if (inner.exists) mc = inner;
  const creativeFolder = findCreativeFolder(mc, deliverable);
  if (!creativeFolder) return { creative: "", edits: [], folders: [] };
  const found = collectEdits(creativeFolder);
  return { creative: String(creativeFolder.name), edits: found.edits, folders: found.folders };
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
export const artworkCheck = (jpgPngPath?: string, componentsPath?: string): ArtworkCheckResult => {
  try {
    const proj = app.project;
    if (!proj.file) {
      return { success: false, error: "Save this project first — the reference is found from where it sits." };
    }

    const projFile = proj.file;
    const deliverable = stripVersion(projFile.name);

    const override = String(jpgPngPath || "").replace(/^\s+|\s+$/g, "");
    const compOverride = String(componentsPath || "").replace(/^\s+|\s+$/g, "");

    let jpgPng: Folder;
    let territory: string;
    // Kept beyond the branch: the masters walk starts from here, and a manual
    // JPG_PNG pick tells us where the territory is even when the project is
    // saved somewhere unexpected.
    let territoryRoot: Folder | null = null;

    if (override) {
      // POINTED AT, not deduced. A project saved outside the tree, a territory
      // laid out differently, a share mounted at another point -- all of them
      // end the automatic walk, and none of them mean the sheet isn't there.
      const picked = resolvePickedJpgPng(override);
      if (!picked) {
        return {
          success: false,
          error: "That folder isn't there any more — pick the JPG_PNG folder again.",
          needsFolder: true,
        };
      }
      jpgPng = picked.folder;
      territory = picked.territory;
      territoryRoot = jpgPng.parent;
    } else {
      // .../Markets/<Territory>/AE/<Batch>/<file>.aep -- so the territory root
      // is three levels up. Walked rather than assumed: a project saved
      // somewhere unexpected should say so instead of reading a stranger's
      // folder.
      let cursor: Folder | null = projFile.parent;
      for (let hops = 0; hops < 6 && cursor; hops++) {
        const maybe = new Folder(cursor.fsName + "/JPG_PNG");
        if (maybe.exists) { territoryRoot = cursor; break; }
        cursor = cursor.parent;
      }
      if (!territoryRoot) {
        return {
          success: false,
          error: "Couldn't find a JPG_PNG folder above this project — is it saved inside a territory? "
            + "If you know where the mech sheets are, point at that folder and it'll check against it.",
          needsFolder: true,
        };
      }
      territory = String(territoryRoot.name);
      jpgPng = new Folder(territoryRoot.fsName + "/JPG_PNG");
    }

    // The masters tree is the sibling campaign folder. Derived from the CSV's
    // own ART path where possible, and only guessed at as a fallback -- see
    // below.
    //
    // One rung deeper for a manual pick: the walk-up lands exactly on JPG_PNG,
    // whereas a person might have picked the territory above it or a batch
    // below.
    const csv = findArtworkCsvUnder(jpgPng, deliverable, override ? 3 : 2);

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

    // --- this creative's own art edits, for picking a replacement ------------
    let creative = "";
    let editsFolder = "";
    let editFolders: string[] = [];
    let edits: ArtworkEdit[] = [];
    let componentsFolder = "";

    if (compOverride) {
      // POINTED AT. The only way to reach a creative whose folder name isn't
      // in the deliverable's, which is the shape of half these jobs.
      const pickedComp = resolvePickedComponents(compOverride, deliverable);
      if (pickedComp) {
        creative = pickedComp.creative;
        edits = pickedComp.edits;
        editFolders = pickedComp.folders;
        componentsFolder = compOverride;
      }
    } else if (territoryRoot) {
      const mc = findMotionComponents(territoryRoot, mastersHint);
      if (mc) {
        componentsFolder = mc.fsName;
        const creativeFolder = findCreativeFolder(mc, deliverable);
        if (creativeFolder) {
          creative = String(creativeFolder.name);
          editsFolder = creativeFolder.fsName;
          const found = collectEdits(creativeFolder);
          edits = found.edits;
          editFolders = found.folders;
        }

        // ── A DELIVERABLE CAN DRAW ON MORE THAN ONE CREATIVE ────────────────
        //
        // The search above scopes to the ONE creative in the deliverable's
        // name, which is right for every deliverable this was written for. A
        // Multiple Art build is not one of those: 15s of PortalToParadise then
        // 15s of Trio is named for the first, so the second's art edits sit in
        // a creative folder nothing was looking in. Reported as "no motion edit
        // exists for FID_INTL_Trio_Vertical_RGB_OV.tif" with the .aep of that
        // exact name sitting in Trio's own Tiffs.
        //
        // So each ROW gets to name a creative too. Only folders a row actually
        // points at are opened -- this is not a widening to "search
        // everything", which would offer another creative's art for a row that
        // never mentioned it.
        const seenCreative: { [key: string]: boolean } = {};
        if (creativeFolder) seenCreative[String(creativeFolder.name)] = true;
        for (let rc = 0; rc < rows.length; rc++) {
          const other = findCreativeFolder(mc, String(rows[rc].name));
          if (!other) continue;
          const oName = String(other.name);
          if (seenCreative[oName]) continue;
          seenCreative[oName] = true;
          const extra = collectEdits(other);
          for (let e = 0; e < extra.edits.length; e++) {
            // LABELLED WITH THE CREATIVE it came from, because "Tiffs" alone
            // would read as this deliverable's own and the whole point is that
            // it is not.
            extra.edits[e].folder = oName + " · " + extra.edits[e].folder;
            edits.push(extra.edits[e]);
          }
          for (let f2 = 0; f2 < extra.folders.length; f2++) {
            editFolders.push(oName + " · " + extra.folders[f2]);
          }
        }
      }
    }

    // --- pair each sheet row to its motion edit, then look for it -----------
    const present = projectItemNames();
    const expected: { [key: string]: boolean } = {};

    for (let r = 0; r < rows.length; r++) {
      const want = editKey(rows[r].name);
      expected[want] = true;

      // The edit built from this tiff. Exact on the loose key; anything that
      // merely EXTENDS the key ("_10") is a variant, offered rather than
      // chosen -- which one a deliverable wants depends on its duration, and
      // the artist knows that.
      const variants: ArtworkEdit[] = [];
      for (let e = 0; e < edits.length; e++) {
        const k = editKey(edits[e].name);
        if (k === want) { rows[r].editName = edits[e].name; rows[r].editPath = edits[e].path; }
        else if (k.indexOf(want) === 0) variants.push(edits[e]);
      }
      if (variants.length) rows[r].editVariants = variants;

      // In the project by either name: the tiff itself, or the edit's comps.
      const foundEdit = rows[r].editName;
      const editWanted = foundEdit ? editKey(foundEdit) : "";
      // Two separate tests, not `a || (b && c)`. The precedence audit rejects
      // that shape outright because parentheses do not survive emit to ES3 --
      // see mcIt()'s isSameType for the same restructuring.
      for (let p = 0; p < present.length; p++) {
        let hit = present[p].key === want;
        if (!hit && editWanted) hit = present[p].key === editWanted;
        if (hit) {
          rows[r].inProject = true;
          break;
        }
      }
    }

    // Art edits present that the sheet never mentions -- the other half of
    // "wrong art edit", and the half that names the culprit. Matched against
    // this creative's own edits so unrelated comps are not paraded as suspects.
    const unexpected: string[] = [];
    for (let p = 0; p < present.length; p++) {
      if (expected[present[p].key]) continue;
      // TIFFS EDITS ONLY. An Edit-folder cut pairs to no sheet row by design,
      // so its presence is never evidence of a wrong art edit -- and a Portal
      // deliverable that is built exactly right would otherwise report its own
      // edit as a suspect every single time, which is how a warning line
      // becomes one nobody reads.
      let isAnEdit = false;
      for (let e = 0; e < edits.length; e++) {
        if (editKey(edits[e].name) !== present[p].key) continue;
        if (String(edits[e].folder).toLowerCase().indexOf("tiff") !== 0) continue;
        isAnEdit = true;
        break;
      }
      const n = present[p].name.toLowerCase();
      const isTiff = n.length > 4 &&
        (n.substring(n.length - 4) === ".tif" || n.substring(n.length - 5) === ".tiff");
      if (!isAnEdit && !isTiff) continue;
      if (unexpected.indexOf(present[p].name) === -1) unexpected.push(present[p].name);
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
      editsFolder: editsFolder,
      editFolders: editFolders,
      edits: edits,
      componentsFolder: componentsFolder,
      componentsPicked: compOverride !== "",
      unexpected: unexpected,
      verdict: verdict,
      jpgPngFolder: jpgPng.fsName,
      picked: override !== "",
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

/**
 * The folder picker behind "Pick the JPG_PNG folder".
 *
 * Returns null on cancel, never a fake error -- cancelling a picker is a
 * decision, not a failure (CLAUDE.md).
 */
export const selectArtworkJpgPngFolder = (): string | null => {
  const folder = Folder.selectDialog("Pick the JPG_PNG folder holding this deliverable's mech sheet");
  return folder ? folder.fsName : null;
};

/** The folder picker behind "Pick the components folder". */
export const selectArtworkComponentsFolder = (): string | null => {
  const folder = Folder.selectDialog("Pick this creative's Tiffs or Edit folder (or Motion_Components)");
  return folder ? folder.fsName : null;
};
