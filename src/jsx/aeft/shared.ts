// =============================================================================
// src/jsx/aeft/shared.ts -- cross-tool helpers, polyfills, and generic
// types/constants (Result, SETTINGS_SECTION, decode) used across every
// category. Split out of aeft.ts, which is now a thin barrel -- see its
// header comment for context.
// =============================================================================

// ES5 Array polyfills -- ExtendScript's JS engine is missing several
// Array.prototype methods everywhere else takes for granted (indexOf,
// filter, map), even though String.prototype.indexOf and Array.prototype.sort
// have always been there. This is a well-known, long-documented ExtendScript
// gotcha, not a bug in the logic below -- it surfaced as a real
// "Function X.indexOf is undefined" error the first time this code actually
// ran inside After Effects. Browser preview mode NEVER executes ExtendScript
// at all (see CLAUDE.md's Testing section, mock-data fallback) -- it only
// exercises the React side -- so this whole class of bug is invisible until
// tested for real in AE, no matter how much preview testing is done first.
// Guarded by a feature check so this is a harmless no-op on any engine that
// already has the real method (don't remove this "just in case AE has it by
// now" without actually testing in the real app -- that's exactly the
// assumption that let this ship broken the first time).
// =============================================================================
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function (searchElement: unknown, fromIndex?: number): number {
    const len = this.length;
    let start = fromIndex || 0;
    if (start < 0) start = Math.max(0, len + start);
    for (let i = start; i < len; i++) {
      if (this[i] === searchElement) return i;
    }
    return -1;
  };
}

if (!Array.prototype.filter) {
  Array.prototype.filter = function (callback: (value: unknown, index: number, arr: unknown[]) => boolean, thisArg?: unknown): unknown[] {
    const result: unknown[] = [];
    for (let i = 0; i < this.length; i++) {
      if (i in this && callback.call(thisArg, this[i], i, this)) result.push(this[i]);
    }
    return result;
  };
}

if (!Array.prototype.map) {
  // Cast to `any`, not typed to match lib.es5.d.ts's generic <U> signature
  // for Array.prototype.map -- this polyfill only needs to be correct JS at
  // runtime (the ES3 ExtendScript engine that's actually missing this
  // method has no type checker), and a hand-written generic here fights
  // TypeScript's own built-in declaration under any tsconfig that also
  // happens to include real DOM/ES5 lib types (e.g. if this file is ever
  // type-checked under the frontend's tsconfig.json instead of the
  // ExtendScript-specific tsconfig-build.json).
  (Array.prototype as any).map = function (callback: (value: unknown, index: number, arr: unknown[]) => unknown, thisArg?: unknown): unknown[] {
    const result: unknown[] = [];
    for (let i = 0; i < this.length; i++) {
      if (i in this) result[i] = callback.call(thisArg, this[i], i, this);
    }
    return result;
  };
}

export interface Result {
  success: boolean;
  error?: string;
}

// --- Shared localiser run reporting (Generate Files / Trott / Trott 2.0) -----
// Structured per-row outcome so these row-based localisers report results in
// one modal instead of the old alert()-per-failure + silent `continue`s. The
// silent no-master/no-comp continues were the exact invisible failure mode MC
// It! had -- a row that found nothing just vanished from the count. Now every
// row is a first-class result the panel can render and the user can act on.
export interface LocGenRowReport {
  source: string; // CSV line summary or PDF filename this row came from
  artwork: string;
  campaign: string;
  size: string;
  duration: string;
  status: "generated" | "skipped-existing" | "no-master" | "no-comp" | "error";
  master?: string; // matched master filename
  output?: string; // written .aep filename
  error?: string;
  // CSV Localiser's two inline passes. Optional: every other tool feeding this
  // report omits them, and the row renders exactly as it did before. Carried
  // on the ROW rather than only in the summary string so a report recovered
  // after a lost page can still add the totals up.
  imagesReplaced?: number;
  imagesNote?: string;
  componentsSwapped?: number;
}

export interface LocGenResult {
  success: boolean;
  error?: string;
  message?: string;
  tool?: string; // "Generate Files" | "Trott" | "Trott 2.0"
  outputFolder?: string;
  rows?: LocGenRowReport[];
  finishedAt?: string;
  runId?: string;
}

// Persist a completed run so a long batch survives the panel being closed
// (the evalTS callback dies with the page). The panel's LocGenReportHost
// polls this file and offers the unseen report back. Mirrors mcIt()'s own
// persistence but in its own slot so the two never clobber each other.
export function saveLocGenReport(result: LocGenResult): void {
  try {
    const dir = new Folder(Folder.userData.fsName + "/XYiToolbox");
    if (!dir.exists) dir.create();
    const f = new File(dir.fsName + "/locgen_last_report.json");
    f.encoding = "UTF-8";
    if (f.open("w")) {
      f.write(JSON.stringify(result));
      f.close();
    }
  } catch (e) {
    /* persistence must never break the run */
  }
}

export const locGenLoadLastReport = (): { success: boolean; json?: string } => {
  try {
    const f = new File(Folder.userData.fsName + "/XYiToolbox/locgen_last_report.json");
    if (!f.exists) return { success: true };
    if (!f.open("r")) return { success: true };
    f.encoding = "UTF-8";
    const json = f.read();
    f.close();
    if (json === "") return { success: true };
    return { success: true, json: json };
  } catch (e) {
    return { success: false };
  }
};

export const locGenClearLastReport = (): { success: boolean } => {
  try {
    const f = new File(Folder.userData.fsName + "/XYiToolbox/locgen_last_report.json");
    if (f.exists) f.remove();
    return { success: true };
  } catch (e) {
    return { success: false };
  }
};

// Build the standard finished-result envelope from a row list.
export function finishLocGenReport(tool: string, rows: LocGenRowReport[], outputFolder: string): LocGenResult {
  let generated = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i].status === "generated") generated++;
  const result: LocGenResult = {
    success: true,
    tool: tool,
    message: generated + " of " + rows.length + " row(s) generated.",
    outputFolder: outputFolder,
    rows: rows,
    finishedAt: new Date().toString(),
    runId: "" + new Date().getTime(),
  };
  saveLocGenReport(result);
  return result;
}

// --- Persistence (campaigns only -- nothing else needs to be saved, since
// this entire library is derived live from disk). Same app.settings section
// and key as XYi_OV_Library.jsx, so campaigns set up in either tool show up
// in the other automatically. ---
export const SETTINGS_SECTION = "XYiToolbox";

export function decode(str: string): string {
  try {
    return decodeURI(str);
  } catch (e) {
    return str;
  }
}

// =============================================================================
// findBestComponentFile -- ported from toolset/XYi_Detectives.jsx's
// findBestComponentFile(), a hybrid Jaccard + Levenshtein + Jaro-Winkler +
// numeric-token + substring scorer for matching one name against a list of
// name-carrying candidates. Originally ported into this codebase as a
// LOS-Tools-private helper (losFindBestComponentFile) before the studio's
// real XYi_Detectives.jsx (a shared module the studio's own Trotting
// Along 2.0/PDF to CSV/MC It!/Cheeky InvT Check all reuse) surfaced --
// promoted here, generic over any {name: string}-shaped candidate, so
// every one of those callers can share ONE implementation instead of each
// getting its own copy at a different fidelity level. File-matching
// callers (LOS Tools, MC It!) pass File[] (which already has a .name);
// name-only callers (territory lookup) pass plain {name, code} records --
// both satisfy the same generic constraint without a wrapper.
// =============================================================================
export function findBestComponentFile<T extends { name: string }>(targetName: string, candidates: T[]): T | null {
  const ACCEPT_THRESHOLD = 0.01;
  const NUMERIC_BOOST = 0.25;
  const SUBSTRING_BOOST = 0.15;

  function norm(s: string): string {
    if (!s) return "";
    s = (s + "").toLowerCase();
    s = s.replace(/\.[a-z0-9]{1,5}$/i, "");
    s = s.replace(/[^a-z0-9]+/g, " ");
    s = s.replace(/\s+/g, " ");
    return s.replace(/^\s+|\s+$/g, "");
  }
  function numbersIn(s: string): string[] {
    const m = (s + "").match(/\d+/g);
    if (!m) return [];
    const seen: Record<string, boolean> = {};
    const arr: string[] = [];
    for (let i = 0; i < m.length; i++) {
      if (!seen[m[i]]) {
        seen[m[i]] = true;
        arr.push(m[i]);
      }
    }
    return arr;
  }

  function jaccardHybrid(inputA: string, inputB: string): number {
    const JACCARD_WEIGHT = 0.7;
    const LEVENSHTEIN_WEIGHT = 0.3;
    function tokenize(filename: string): string[] {
      const cleanName = String(filename || "")
        .replace(/\.aep|_V\d+/gi, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2");
      const tokens = cleanName.toLowerCase().split(/[_\-\s]+/);
      // The format keywords come from the inline matchers XYi_Campaign_Trotting2.jsx
      // and XYi_PDF_to_CSV.jsx carried before both were switched to the shared
      // Detectives matcher (2026-07-31). They describe the PHYSICAL FORMAT of a
      // placement, never which creative it is, so leaving them in let two
      // unrelated campaigns score as similar purely for sharing "30SHEET".
      const stopWords = [
        "dgtl", "digital", "master", "ov", "en", "the",
        "6sheet", "30sheet", "48sheet", "96sheet",
        "extreme", "horizontal", "square", "quad", "tall", "portrait",
      ];
      const finalTokens: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token && stopWords.indexOf(token) === -1 && !/^\d+x\d+$/.test(token)) finalTokens.push(token);
      }
      return finalTokens;
    }
    function levenshteinDistance(s: string, t: string): number {
      s = String(s || "");
      t = String(t || "");
      if (!s.length) return t.length;
      if (!t.length) return s.length;
      const arr: number[][] = [];
      for (let i = 0; i <= t.length; i++) {
        arr[i] = [];
        arr[i][0] = i;
      }
      for (let j = 0; j <= s.length; j++) arr[0][j] = j;
      for (let i = 1; i <= t.length; i++) {
        for (let j = 1; j <= s.length; j++) {
          const cost = s.charAt(j - 1) === t.charAt(i - 1) ? 0 : 1;
          let min = arr[i - 1][j] + 1;
          if (arr[i][j - 1] + 1 < min) min = arr[i][j - 1] + 1;
          if (arr[i - 1][j - 1] + cost < min) min = arr[i - 1][j - 1] + cost;
          arr[i][j] = min;
        }
      }
      return arr[t.length][s.length];
    }
    const tokensA = tokenize(inputA);
    const tokensB = tokenize(inputB);
    if (!tokensA.length && !tokensB.length) return 0;
    const setA: Record<string, boolean> = {};
    const setB: Record<string, boolean> = {};
    for (let i = 0; i < tokensA.length; i++) setA[tokensA[i]] = true;
    for (let j = 0; j < tokensB.length; j++) setB[tokensB[j]] = true;
    let intersection = 0;
    let union = 0;
    for (const k in setA) {
      union++;
      if (setB[k]) intersection++;
    }
    for (const k in setB) {
      if (!setA[k]) union++;
    }
    const jaccardScore = union === 0 ? 0 : intersection / union;
    let finalScore = jaccardScore;
    const cleanStrA = tokensA.join(" ");
    const cleanStrB = tokensB.join(" ");
    const maxLen = Math.max(cleanStrA.length, cleanStrB.length);
    if (maxLen > 0) finalScore = jaccardScore * JACCARD_WEIGHT + (1 - levenshteinDistance(cleanStrA, cleanStrB) / maxLen) * LEVENSHTEIN_WEIGHT;
    return finalScore;
  }

  function jaroWinkler(s1: string, s2: string): number {
    s1 = String(s1 || "");
    s2 = String(s2 || "");
    if (s1 === s2) return 1;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;
    const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
    const matches1: boolean[] = new Array(len1);
    const matches2: boolean[] = new Array(len2);
    let m = 0;
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, len2);
      for (let j = start; j < end; j++) {
        if (!matches2[j] && s1.charAt(i) === s2.charAt(j)) {
          matches1[i] = true;
          matches2[j] = true;
          m++;
          break;
        }
      }
    }
    if (m === 0) return 0;
    let t = 0;
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (matches1[i]) {
        while (!matches2[k]) k++;
        if (s1.charAt(i) !== s2.charAt(k)) t++;
        k++;
      }
    }
    t = t / 2.0;
    let jaro = (m / len1 + m / len2 + (m - t) / m) / 3.0;
    if (jaro > 0.7) {
      let prefix = 0;
      for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
        if (s1.charAt(i) === s2.charAt(i)) prefix++;
        else break;
      }
      jaro += prefix * 0.1 * (1 - jaro);
    }
    return jaro;
  }

  const targetNorm = norm(targetName);
  if (!targetNorm) return null;
  const targetNums = numbersIn(targetName);

  for (let e = 0; e < candidates.length; e++) {
    if (norm(candidates[e].name) === targetNorm) return candidates[e];
  }

  let best: T | null = null;
  let bestScore = -1;
  for (let c = 0; c < candidates.length; c++) {
    const cname = candidates[c].name;
    const cbase = norm(cname);
    const jaccardLevScore = jaccardHybrid(targetName, cname);
    const jwScore = jaroWinkler(targetNorm, cbase);
    const blendedBaseScore = jwScore * 0.6 + jaccardLevScore * 0.4;

    let substringBonus = 0;
    if (cbase.indexOf(targetNorm) !== -1 || targetNorm.indexOf(cbase) !== -1) substringBonus = SUBSTRING_BOOST;

    const cNums = numbersIn(cname);
    let numInter = 0;
    if (targetNums.length && cNums.length) {
      for (let a = 0; a < targetNums.length; a++) {
        for (let b = 0; b < cNums.length; b++) {
          if (targetNums[a] === cNums[b]) {
            numInter++;
            break;
          }
        }
      }
    }
    const numRatio = targetNums.length ? numInter / targetNums.length : 0;
    const score = blendedBaseScore + NUMERIC_BOOST * numRatio + substringBonus;
    if (score > bestScore) {
      bestScore = score;
      best = candidates[c];
    }
  }
  if (best && bestScore >= ACCEPT_THRESHOLD) return best;
  return best;
}
// =============================================================================
// Deliverable filename construction -- ONE builder, shared by every tool that
// writes a localised file.
//
// The studio changed this convention in the 2026-07-31 script handover
// (XYi_Campaign_Scanner.jsx). Four things moved at once:
//
//   was  <Title>_<INTL|DOM>_DGTL_<Artwork>_<CAMPAIGN>_<WxH>_<N>sec_<CC>
//   now  <Title>_<INTL|DOM>_<Campaign>_<Artwork>[_<Site>]_<WxH>px_<N>s_<CC>
//
// i.e. DGTL dropped, campaign and artwork swapped, an optional media-site
// token added after the artwork, and "px"/"s" suffixes on size/duration.
// Campaign also keeps its original casing now (the old scanner upper-cased it).
//
// This lived inline at five separate call sites before, which is exactly how
// they would drift apart the next time the convention moves -- one function
// instead, so a future change is one edit. nameGeneratorParse() reads BOTH
// conventions, so files already on disk under the old name keep working; only
// what we WRITE changes.
// =============================================================================
export interface DeliverableNameParts {
  filmTitle: string;
  region: string; // "INTL" | "DOM"
  campaign: string;
  artworkType: string;
  site?: string; // omitted/empty for a deliverable with no media site
  width: number | string;
  height: number | string;
  duration: string; // accepts "15", "15s" or "15sec" -- normalised below
  territory: string;
}

// Reduce whatever the CSV/parser handed us to bare digits. The spec sheets and
// the two parsers disagree on this ("15", "15s", "15sec" all occur in real
// data), and the written name needs exactly one of them.
export function durationDigits(duration: string): string {
  const m = String(duration == null ? "" : duration).match(/\d+/);
  return m ? m[0] : "";
}

// The form used to MATCH against masters already on disk. Masters now come in
// BOTH forms -- the ones already on disk were never renamed ("_10sec_"), and
// everything written from 2026-08 onward uses the new "_10s_" -- so the "sec"
// here is NOT a convention assumption: durationMatchesPath() reduces this to
// bare digits and matches "s" or "sec" either way. The suffix is kept purely
// so a caller that string-compares this value can't have a bare "10"
// false-match the "10" inside "1080x1920".
export function durationForMasterLookup(duration: string): string {
  const digits = durationDigits(duration);
  return digits === "" ? "" : digits + "sec";
}

export function buildDeliverableName(parts: DeliverableNameParts): string {
  const rawSite = parts.site == null ? "" : String(parts.site).replace(/^\s+|\s+$/g, "");
  const sitePart = rawSite === "" ? "" : "_" + rawSite;
  const digits = durationDigits(parts.duration);
  return (
    parts.filmTitle +
    "_" +
    parts.region +
    "_" +
    parts.campaign +
    "_" +
    parts.artworkType +
    sitePart +
    "_" +
    parts.width +
    "x" +
    parts.height +
    "px_" +
    digits +
    "s_" +
    parts.territory
  );
}

// =============================================================================
// Media-site token sanitising -- ONE sanitiser, shared by every tool that
// writes a site into a deliverable name.
//
// It lived inside localise.ts serving only csvLocaliserRun, which meant the
// other two writers (campaignLocaliserGenerate, nameGeneratorGenerate) put raw
// text straight into a filename: unfolded accents, spaces, and none of the
// misread guards below. Moved here for the same reason buildDeliverableName is
// here -- a convention this file owns should not have three implementations,
// two of which are "none".
// =============================================================================
// Latin-1/Latin Extended-A accent folding, keyed by CODE POINT rather than by
// character literals on purpose: this file compiles down to an ExtendScript
// .jsx whose source encoding can't be relied on to carry non-ASCII literals
// intact, so "é" written here could arrive mangled. Code points can't be.
// Anything not listed (Cyrillic, CJK, emoji) simply gets dropped by
// sanitiseSiteToken's A-Z0-9 filter rather than transliterated.
const SITE_ACCENT_FOLD: { [code: string]: string } = {
  "192": "A", "193": "A", "194": "A", "195": "A", "196": "A", "197": "A", "256": "A", "258": "A", "260": "A",
  "198": "AE",
  "199": "C", "262": "C", "264": "C", "266": "C", "268": "C",
  "270": "D", "272": "D",
  "200": "E", "201": "E", "202": "E", "203": "E", "274": "E", "276": "E", "278": "E", "280": "E", "282": "E",
  "284": "G", "286": "G", "288": "G", "290": "G",
  "292": "H", "294": "H",
  "204": "I", "205": "I", "206": "I", "207": "I", "296": "I", "298": "I", "300": "I", "302": "I", "304": "I",
  "308": "J",
  "310": "K",
  "313": "L", "315": "L", "317": "L", "319": "L", "321": "L",
  "209": "N", "323": "N", "325": "N", "327": "N",
  "210": "O", "211": "O", "212": "O", "213": "O", "214": "O", "216": "O", "332": "O", "334": "O", "336": "O",
  "338": "OE",
  "340": "R", "342": "R", "344": "R",
  "346": "S", "348": "S", "350": "S", "352": "S",
  "354": "T", "356": "T", "358": "T",
  "217": "U", "218": "U", "219": "U", "220": "U", "360": "U", "362": "U", "364": "U", "366": "U", "368": "U", "370": "U",
  "372": "W",
  "221": "Y", "374": "Y", "376": "Y",
  "377": "Z", "379": "Z", "381": "Z",
  "223": "SS",
  "224": "A", "225": "A", "226": "A", "227": "A", "228": "A", "229": "A", "257": "A", "259": "A", "261": "A",
  "230": "AE",
  "231": "C", "263": "C", "265": "C", "267": "C", "269": "C",
  "271": "D", "273": "D",
  "232": "E", "233": "E", "234": "E", "235": "E", "275": "E", "277": "E", "279": "E", "281": "E", "283": "E",
  "285": "G", "287": "G", "289": "G", "291": "G",
  "293": "H", "295": "H",
  "236": "I", "237": "I", "238": "I", "239": "I", "297": "I", "299": "I", "301": "I", "303": "I", "305": "I",
  "309": "J",
  "311": "K",
  "314": "L", "316": "L", "318": "L", "320": "L", "322": "L",
  "241": "N", "324": "N", "326": "N", "328": "N",
  "242": "O", "243": "O", "244": "O", "245": "O", "246": "O", "248": "O", "333": "O", "335": "O", "337": "O",
  "339": "OE",
  "341": "R", "343": "R", "345": "R",
  "347": "S", "349": "S", "351": "S", "353": "S",
  "355": "T", "357": "T", "359": "T",
  "249": "U", "250": "U", "251": "U", "252": "U", "361": "U", "363": "U", "365": "U", "367": "U", "369": "U", "371": "U",
  "373": "W",
  "253": "Y", "255": "Y", "375": "Y",
  "378": "Z", "380": "Z", "382": "Z",
};

// A raw MEDIA SITE NAME off a client PDF ("Gare de l'Est — Quai 3", "Bahnhof
// Zoo/Süd") or off a Wrike subtask name ("PiccadillyLights") is turned into ONE
// A-Za-z0-9 token safe for a filename on any filesystem: accents folded to
// their base letter, everything else (spaces, punctuation, slashes, dashes,
// anything non-Latin) dropped rather than replaced -- notably NO underscores,
// since every downstream tool in this toolbox splits these filenames on "_" and
// an extra separator inside the site would silently shift their token indices.
// Capped at 40 chars to keep the already-long generated names inside path
// limits.
//
// Casing is camelCaseName's rule -- the same one the campaign/artwork token
// uses, so a site and a creative in the same filename can't disagree about the
// convention. See camelCaseName for why the decision is made per value:
//
//   "PiccadillyLights"  -> PiccadillyLights   (already one word: untouched)
//   "Piccadilly Lights" -> PiccadillyLights
//   "gare de l'Est"     -> GareDeLEst
//   "GENERIC"           -> Generic            (all caps: title-cased)
//   "IMAX SIGNAGE"      -> IMAXSignage        (listed acronym keeps its caps)
//
// On top of that it adds the two things only a SITE needs: the guards below
// (a site token sits ahead of the real size/version/duration/territory tokens,
// so a site shaped like one wins the parsers' first match) and a 40-char cap.
export function sanitiseSiteToken(raw: string): string {
  const guarded = guardSiteToken(camelCaseName(raw));
  return guarded.length > 40 ? guarded.substring(0, 40) : guarded;
}

// Studio acronyms that stay SHOUTED even inside an all-caps value. Without
// this list, "IMAX SIGNAGE" off a client PDF would title-case into
// "ImaxSignage" -- correct for the second word, wrong for the first.
//
// Only needed for values that are ENTIRELY upper case: the moment a value
// carries one lower-case letter ("IMAX Signage"), camelCaseName preserves it
// verbatim and this list is never consulted. So a missing entry only ever
// costs a shouted acronym its caps, never a name its meaning -- and adding one
// is a one-line edit here.
//
// Keyed as an object, not an array with indexOf, so a lookup stays O(1) and
// no polyfill is involved.
const NAME_ACRONYMS: { [word: string]: boolean } = {
  IMAX: true, LSQ: true, BFI: true, QUAD: true, HPTO: true, OOH: true,
  DOOH: true, DFOH: true, DINTH: true, FOH: true, TOS: true, UPIM: true,
  PLF: true, DGTL: true, OV: true, INTL: true, DOM: true, CW: true,
  MM: true, EPO: true, BLB: true, VIP: true, AV: true, TV: true, UK: true,
  IRE: true, AUS: true, NZ: true, INT: true, NM: true, USA: true, GER: true,
  // Site acronyms seen in real Wrike subtask names, where they sit all-caps
  // inside otherwise-CamelCase names ("FID_INTL_Trio_DINTH_INTHDS_..."), which
  // is exactly what marks them as acronyms rather than shouting.
  INTHDS: true, AMC: true,
};

// The convention every NAME token follows: one CamelCase A-Za-z0-9 word.
//
// The case rule is decided per VALUE, because "TRIO" and "IMAX" are the same
// shape and only knowledge of the word tells them apart:
//
//   value has ANY lower-case letter  -> it is meaningfully cased, PRESERVE it
//   value is entirely UPPER case     -> that is shouting, not meaning:
//                                       title-case each word, except acronyms
//
// So a client PDF that shouts every cell still yields readable names, while a
// value someone deliberately cased -- "PortalToParadise", "IMAX Signage",
// "GareDuNord" -- comes through exactly as written:
//
//   "PortalToParadise"   -> PortalToParadise   (has lower case: preserved)
//   "Portal To Paradise" -> PortalToParadise
//   "IMAX Signage"       -> IMAXSignage        (has lower case: preserved)
//   "TRIO"               -> Trio               (all caps: title-cased)
//   "GENERIC SITE"       -> GenericSite
//   "IMAX SIGNAGE"       -> IMAXSignage        (all caps, but IMAX is listed)
//
// NOT for film titles -- those are identifiers lifted off the master filename
// ("FID", "ODY"), where title-casing would rename the film. They use
// camelCaseToken, which never re-cases anything.
export function camelCaseName(raw: string): string {
  const trimmed = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
  if (trimmed === "") return "";
  // Tested on the RAW value, before folding: folding maps to upper-case
  // letters, so testing after it would call every accented lower-case name
  // "shouted".
  const shouted = !NAME_HAS_LOWER.test(trimmed);
  if (!shouted) return camelCaseToken(trimmed);
  const words = splitNameWords(foldNameAccents(trimmed));
  let out = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    out += NAME_ACRONYMS[word] ? word : word.charAt(0).toUpperCase() + word.substring(1).toLowerCase();
  }
  return out;
}

const NAME_HAS_LOWER = /[a-z]/;

// Collapse to one token, NEVER re-casing anything -- for name parts that are
// IDENTIFIERS rather than descriptions.
//
// Free text in, ONE A-Za-z0-9 token out: accents folded to their base letter,
// separators and punctuation dropped, word starts capitalised, and no letter
// ever lowered. That last part is why film titles use this and not
// camelCaseName: a title is the studio's short code for the film ("FID",
// "ODY"), and title-casing it to "Fid" would rename the film.
//
//   "FID"                -> FID                (identifier: untouched)
//   "The Odyssey"        -> TheOdyssey
//   "PortalToParadise"   -> PortalToParadise
//   "PORTAL TO PARADISE" -> PORTALTOPARADISE   (caps never flattened here)
export function camelCaseToken(raw: string): string {
  const trimmed = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
  if (trimmed === "") return "";
  const words = splitNameWords(foldNameAccents(trimmed));
  let token = "";
  for (let i = 0; i < words.length; i++) {
    token += words[i].charAt(0).toUpperCase() + words[i].substring(1);
  }
  return token;
}

// Accents to their base letter, case kept. The fold table is written entirely
// in upper case, so a mapped LOWER-case source character has to be put back
// down or "Süd" would come out "SUd" -- losing the case exactly on the
// accented names the table exists for.
// Written as plain statements, NOT as a nested ternary. The parenthesised form
//
//   folded += mapped ? (ch !== ch.toUpperCase() ? mapped.toLowerCase() : mapped) : ch;
//
// is what shipped on 2026-08-10, and it broke the panel outright: esbuild
// strips the redundant parentheses, leaving `a ? b ? c : d : e`, and the
// ExtendScript parser cannot tell which colon belongs to which "?" -- the
// whole bundle fails to load with "SyntaxError: Expected: :". A ternary CHAIN
// (`a ? x : b ? y : z`) parses fine and is used all over this codebase; it is
// specifically a ternary nested in the CONSEQUENT that it chokes on. Never
// reintroduce one, in any file under src/jsx.
function foldNameAccents(s: string): string {
  let folded = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    const mapped = SITE_ACCENT_FOLD[String(s.charCodeAt(i))];
    if (!mapped) {
      folded += ch;
    } else if (ch !== ch.toUpperCase()) {
      folded += mapped.toLowerCase();
    } else {
      folded += mapped;
    }
  }
  return folded;
}

// Runs of A-Za-z0-9. Everything else (spaces, punctuation, slashes, dashes,
// anything non-Latin the fold table didn't cover) is a separator and is
// DROPPED rather than replaced -- notably never turned into "_", which every
// filename parser in this toolbox tokenises on.
function splitNameWords(folded: string): string[] {
  const words: string[] = [];
  let current = "";
  for (let i = 0; i < folded.length; i++) {
    const c = folded.charAt(i);
    if (SITE_ALNUM.test(c)) {
      current += c;
    } else if (current !== "") {
      words.push(current);
      current = "";
    }
  }
  if (current !== "") words.push(current);
  return words;
}

// Deliberately NOT global: a /g regex carries `lastIndex` between .test()
// calls, so reusing one per character would skip every other match.
const SITE_ALNUM = /[A-Za-z0-9]/;

// Three shapes a site name could sanitise into that would be MISREAD by the
// filename parsers this toolbox already runs over these names -- every one of
// them takes the FIRST match in the string, and the site token sits ahead of
// the real size/version/territory tokens, so a collision wins outright:
//
//   "4x3"  -> mcItParseFilename's /\d+x\d+/i reads it as the AEP's resolution,
//             no image candidate passes the resolution filter, and that file's
//             inline MC It! swap silently does nothing.
//   "V2"   -> parseFilenameMeta's /(V\d+)/ reads it as the version instead of
//             the real _V01, and Cheeky DT stamps it onto the Frontcard.
//   "SW"   -> parseFilenameMeta's /_([A-Z]{2})(?:_|$)/ reads it as the country
//             code instead of the real one at the end of the name.
//
// Each is defused with the smallest edit that breaks the pattern while leaving
// the name readable, and NOTHING else is touched -- a token with none of these
// shapes (the overwhelmingly normal case) comes through byte-identical. The
// hyphen is chosen deliberately: it can't be confused with "_", which every
// tool here tokenises these filenames on.
//
//   "5s"   -> durationMatchesPath's /(^|[^0-9])<n>s(ec)?([^0-9]|$)/i reads it
//             as the row's duration, so a master of the wrong length passes the
//             duration filter.
//
// The duration and size shapes used to be listed here as UNGUARDABLE-BY-
// CONSTRUCTION, on the grounds that parseFilenameMeta's /(\d+)s(?:ec)?/ and
// /(\d+x\d+)(?:px)?/ are lowercase with no /i while the token was uppercase by
// construction. The token is no longer uppercase by construction (see
// sanitiseSiteToken), so both are guarded explicitly now -- and the
// duration one in either case, because durationMatchesPath DOES use /i and was
// always reachable.
function guardSiteToken(token: string): string {
  if (token === "") return "";
  // Lookahead, not a captured trailing digit: a consuming match would step
  // past the digit and leave a second "3X2" inside "4X3X2" unguarded.
  let guarded = token.replace(/(\d)([xX])(?=\d)/g, "$1-$2");
  guarded = guarded.replace(/V(?=\d)/g, "V-");
  guarded = guarded.replace(/(\d)(?=[sS])/g, "$1-");
  // Only an EXACTLY-two-letter token can be mistaken for a country code
  // ("N4" and single letters can't match /^[A-Za-z]{2}$/), so this is the one
  // case with nothing internal to break -- it gets qualified instead.
  if (/^[A-Za-z]{2}$/.test(guarded)) guarded = "Site" + guarded;
  return guarded;
}
