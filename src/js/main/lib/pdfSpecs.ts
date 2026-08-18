// =============================================================================
// src/js/main/lib/pdfSpecs.ts
// -----------------------------------------------------------------------------
// PDF delivery-spec parser, ported from the TimeHub website's
// utils/pdfTableParser.js (the same parser behind the site's "Scan PDF" ->
// CSV Preview). Reads a territory's Masters/Specs/*.pdf, pulls the delivery
// table out by column geometry, and reshapes each row into the
// Artwork/Campaign/Size/Duration/Country shape the CSV Localiser consumes.
//
// Runs PANEL-SIDE (CEP has Node + a real Chromium). ExtendScript cannot parse
// PDF bytes, so the host side only ever enumerates folders -- the actual read
// + parse happens here and the result is handed to csvLocaliserRun() as the
// exact [METADATA]/CSV text a human would otherwise paste.
//
// pdf.js: the v3 *legacy* build is used deliberately -- AE ships an older CEF
// across versions, and the legacy bundle targets that. Worker runs from the
// bundled asset URL (Vite rewrites the ?url import to a resolvable path).
// =============================================================================
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
// Register the worker's message handler on the main thread (sets
// globalThis.pdfjsWorker). pdf.js then runs entirely in-process -- no Worker()
// spawn, no hashed asset-URL to resolve. That matters in CEP: the panel loads
// from a subdir/file:// where a bundled worker-asset URL wouldn't resolve, and
// classic Workers under file:// are unreliable in CEF. With the main-thread
// handler present, pdf.js's _initialize() skips real-Worker creation outright
// (see pdf.js: `!isWorkerDisabled && !_mainThreadWorkerMessageHandler`). Spec
// tables are tiny, so main-thread parsing costs nothing noticeable.
// @ts-ignore -- side-effect import, no types
import "pdfjs-dist/legacy/build/pdf.worker.entry.js";

// ─── column targets (identical keys to the website parser) ────────────────────

interface TargetCol {
  key: string;
  match: RegExp;
}

const TARGET_COLS: TargetCol[] = [
  { key: "artworkType", match: /(dinth|foh|dooh)/i },
  // "ARTWORK" and "SELECTION" sit on two header lines; depending on how the PDF
  // interleaves rows they don't always cluster together, so also match the
  // distinctive lower word alone. "SELECTION" appears in no other header here.
  { key: "campaignSelection", match: /(artwork.{0,20}selection|\bselection\b)/i },
  { key: "mediaSiteName", match: /media.{0,20}site/i },
  // Newer templates label these plainly "WIDTH" / "HEIGHT" (with a separate
  // "UNIT OF MEASUREMENT" column) rather than "PIXEL WIDTH". The bare word
  // catches both.
  { key: "pixelWidth", match: /\bwidth\b/i },
  { key: "pixelHeight", match: /\bheight\b/i },
  { key: "duration", match: /\bduration\b/i },
  { key: "soundReq", match: /\bsound\b/i },
  { key: "fileSize", match: /file.{0,20}size/i },
  { key: "bitRate", match: /bit.{0,10}rate/i },
  // Needed to SPOT SWAPS, not just to report fps: territories regularly put the
  // frame rate in the bitrate column and vice versa, and you can only tell
  // which way round it went by reading both.
  { key: "frameRate", match: /(frame.{0,10}rate|\bfps\b)/i },
  { key: "specificVideo", match: /specific.{0,30}video/i },
];

export type RawSpec = Record<string, string>;

interface Cell {
  str: string;
  x: number;
  w: number;
  cx: number;
}

interface Cluster {
  cx: number;
  items: Cell[];
  text: string;
  x: number;
  xEnd: number;
}

interface ColBand {
  key: string;
  x: number;
  xEnd: number;
}

// ─── helpers (ported 1:1 from the website parser) ─────────────────────────────

function groupIntoRows(items: any[], yTol = 4): Cell[][] {
  const map = new Map<number, Cell[]>();
  items.forEach((item) => {
    const y = item.transform[5];
    let found: number | null = null;
    for (const [ky] of map) {
      if (Math.abs(ky - y) <= yTol) {
        found = ky;
        break;
      }
    }
    const key: number = found === null ? y : found;
    if (!map.has(key)) map.set(key, []);
    // cx (horizontal centre) is what cells are matched on, not the left edge:
    // a value's left edge shifts with its length in a centred column, but its
    // centre stays put regardless of digit count.
    const x = item.transform[4];
    const w = item.width || 0;
    map.get(key)!.push({ str: String(item.str).trim(), x, w, cx: x + w / 2 });
  });
  return [...map.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, cells]) => cells.filter((c) => c.str).sort((a, b) => a.x - b.x));
}

// Cluster header labels by CENTRE (multi-line centred labels share a centre
// even when their left edges are far apart), then carve the page into bands at
// the midpoint between adjacent label centres so a column's width comes from
// its neighbours, not from how long its own label happens to be.
function buildHeaderClusters(cells: Cell[], tol = 6): Cluster[] {
  const clusters: Cluster[] = [];
  cells.forEach((cell) => {
    const ex = clusters.find((c) => Math.abs(c.cx - cell.cx) <= tol);
    if (ex) ex.items.push(cell);
    else clusters.push({ cx: cell.cx, items: [cell], text: "", x: 0, xEnd: 0 });
  });
  clusters.forEach((c) => {
    c.cx = c.items.reduce((s, i) => s + i.cx, 0) / c.items.length;
    c.text = [...new Set(c.items.map((i) => i.str))].join(" ");
  });
  clusters.sort((a, b) => a.cx - b.cx);
  clusters.forEach((c, i) => {
    c.x = i === 0 ? -Infinity : (clusters[i - 1].cx + c.cx) / 2;
    c.xEnd = i === clusters.length - 1 ? Infinity : (c.cx + clusters[i + 1].cx) / 2;
  });
  return clusters;
}

const HEADER_ROWS = 20;

// The header is the row mentioning the most DISTINCT target columns -- scoring
// this way keeps a data cell that happens to contain a header's own words
// (e.g. "File size below 20mb") from being mistaken for the header.
function findHeaderRow(rows: Cell[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < Math.min(rows.length, HEADER_ROWS); r++) {
    const text = rows[r].map((c) => c.str).join(" ");
    const score = TARGET_COLS.filter((tc) => tc.match.test(text)).length;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// Every header cluster becomes a band [x, xEnd) -- including columns we DON'T
// extract, so they act as walls a wanted column can't bleed past.
function detectColumns(rows: Cell[][], headerRow: number, headerEnd = headerRow + 1): ColBand[] {
  // All header lines up to (but not including) the first data row. Labels wrap
  // BOTH ways: "ARTWORK" / "SELECTION" and "MEDIA APPROVED?" wrap DOWNWARD, so
  // stopping at headerRow+1 dropped the lower line. headerEnd is the data-start
  // row, so this captures every header line while staying clear of data.
  const headerCells = rows.slice(0, headerEnd).flat();
  const clusters = buildHeaderClusters(headerCells);

  const colMap: ColBand[] = [];
  TARGET_COLS.forEach((tc) => {
    const idx = clusters.findIndex((c) => tc.match.test(c.text));
    if (idx !== -1) {
      colMap.push({ key: tc.key, x: clusters[idx].x, xEnd: clusters[idx].xEnd });
      return;
    }
    // Fallback: a non-centre-aligned label whose words landed in adjacent
    // clusters ("PIXEL" / "WIDTH"). Span both bands.
    for (let i = 0; i < clusters.length - 1; i++) {
      const t2 = clusters[i].text + " " + clusters[i + 1].text;
      if (tc.match.test(t2)) {
        colMap.push({ key: tc.key, x: clusters[i].x, xEnd: clusters[i + 1].xEnd });
        return;
      }
    }
  });

  return colMap;
}

function findDataStart(rows: Cell[][], colMap: ColBand[], from = 0): number {
  const numericKeys = ["pixelWidth", "pixelHeight", "duration"];
  const numCols = numericKeys
    .map((k) => colMap.find((c) => c.key === k))
    .filter(Boolean) as ColBand[];

  for (let r = from; r < rows.length; r++) {
    const hits = numCols.filter((col) =>
      rows[r].some(
        (cell) => /^\d+(\.\d+)?$/.test(cell.str) && cell.cx >= col.x && cell.cx < col.xEnd
      )
    ).length;
    if (hits >= 1) return r;
  }
  return from;
}

// A cell belongs to the band its CENTRE lands in -- contiguous, mutually
// exclusive, no tolerance cushions (which used to let long centred names drift
// into a neighbour's column).
function assignCells(row: Cell[], colMap: ColBand[]): RawSpec {
  const record: RawSpec = {};
  row.forEach((cell) => {
    const col = colMap.find((c) => cell.cx >= c.x && cell.cx < c.xEnd);
    if (col) {
      record[col.key] = record[col.key] ? record[col.key] + " " + cell.str : cell.str;
    }
  });
  return record;
}

// ─── public: parse ────────────────────────────────────────────────────────────

export async function parsePdfDeliverySpecs(data: Uint8Array): Promise<RawSpec[] | null> {
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const allItems: any[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    content.items.forEach((item: any) => {
      if (item.str && String(item.str).trim()) allItems.push(item);
    });
  }
  if (!allItems.length) return null;

  const rows = groupIntoRows(allItems);
  const headerRow = findHeaderRow(rows);

  // First pass: columns from the header row alone, enough to locate the data.
  const prelimCols = detectColumns(rows, headerRow);
  if (!prelimCols.length) return null;

  const dataStart = findDataStart(rows, prelimCols, headerRow + 1);

  // Second pass: re-detect across ALL header lines above the data so multi-line
  // headers like "ARTWORK SELECTION" are clustered whole.
  const colMap = detectColumns(rows, headerRow, dataStart);
  if (!colMap.length) return null;

  const results = rows
    .slice(dataStart)
    .map((row) => assignCells(row, colMap))
    .filter((rec) => Object.values(rec).some((v) => v && v.trim()));

  return results.length ? results : null;
}

// ─── public: reshape to CSV-Localiser rows ────────────────────────────────────

export interface SpecRow {
  Artwork: string;
  Campaign: string;
  Size: string;
  Duration: string;
  Country: string;
  // MEDIA SITE NAME straight off the PDF -- shown in the specs table so a row
  // can be tied back to the screen it's for. Informational only: the host's
  // csvLocaliserRun() reads columns 0-3 positionally and never looks at this.
  Site: string;
  // --- delivery spec, normalised. "" when the PDF didn't say. ---------------
  // These were being parsed off the PDF and then dropped on the floor, which
  // is why Delivery's size field has always been typed by hand and why nothing
  // could check a finished file against what it was supposed to be.
  /** Target file size in MB (decimal, matching deliver.ts's own maths). */
  FileSize: string;
  /** Target/max video bitrate in Mbps. */
  BitRate: string;
  /** Frame rate. */
  Fps: string;
  /** The sheet's Sound column, normalised: "yes", "no", or "" when it is
   *  silent. Kept as a string rather than a boolean precisely so "the PDF
   *  didn't say" stays distinguishable from "the PDF said no". */
  Sound: string;
  /** Human-readable warnings about THIS row, "" when clean. Never auto-corrected
   *  -- see validateSpecValues. Deliberately not written to the CSV. */
  Flags: string;
}

// --- value shapes ----------------------------------------------------------
// The parser is positional: a cell belongs to whichever column band its centre
// lands in, and the header is trusted. That is correct behaviour on correct
// input, but territories fill these tables by hand and routinely put the fps in
// the bitrate column, the bitrate in the fps column, KB where MB was asked for.
// So each value is checked against the SHAPE its column claims, and a mismatch
// is FLAGGED rather than silently moved: a wrong bitrate is a wrong delivery,
// and a parser that "helpfully" corrected it would hide that.
const PLAUSIBLE_FPS = [23.976, 24, 25, 29.97, 30, 50, 60];

function looksLikeFps(n: number): boolean {
  for (const f of PLAUSIBLE_FPS) {
    if (Math.abs(n - f) < 0.05) return true;
  }
  return false;
}

/**
 * EVERY number in a cell, with whatever unit was written beside it.
 *
 * firstNumber() takes the first and silently drops the rest, which is wrong
 * whenever a client crams two values into one column -- "50MB / 8Mbps" in the
 * bitrate cell reads as a bitrate of 50, and the sheet looks like it was parsed
 * cleanly. Silent truncation of somebody's spec is exactly the failure this
 * file exists to prevent.
 *
 * The unit is evidence, not a guess: a number the client themselves labelled
 * "Mbps" is a bitrate whichever column it landed in.
 */
interface CellNumber { value: number; unit: string; raw: string }

function cellNumbers(v: string): CellNumber[] {
  const out: CellNumber[] = [];
  const text = String(v || "");
  // Unit first where one is written; the alternation is longest-first so
  // "mbps" is not read as "mb" with a stray "ps".
  const re = /(\d+(?:[.,]\d+)?)\s*(mbit\/s|mbits|mbps|kbps|kbit\/s|gb|mb|kb|fps|hz|p)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1].replace(",", "."));
    if (isNaN(n)) continue;
    out.push({ value: n, unit: (m[2] || "").toLowerCase(), raw: m[0].trim() });
    if (re.lastIndex === m.index) re.lastIndex++;   // never spin on an empty match
  }
  return out;
}

/** The number whose unit matches one of `units`, or null when none is labelled. */
function pickByUnit(nums: CellNumber[], units: string[]): CellNumber | null {
  for (const n of nums) if (n.unit && units.indexOf(n.unit) !== -1) return n;
  return null;
}

/** First number in a string, or null. */
function firstNumber(v: string): number | null {
  const m = String(v || "").match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(",", "."));
  return isNaN(n) ? null : n;
}

/** -> MB. Decimal (1 MB = 1000 KB), matching deliver.ts's own size maths. */
function normaliseFileSize(v: string): { mb: number | null; note: string } {
  const raw = String(v || "").trim();
  if (!raw) return { mb: null, note: "" };
  const nums = cellNumbers(raw);
  if (nums.length > 1) {
    const sz = pickByUnit(nums, ["gb", "mb", "kb"]);
    if (sz) {
      const mb = sz.unit === "gb" ? sz.value * 1000 : sz.unit === "kb" ? sz.value / 1000 : sz.value;
      return { mb, note: `file size cell reads "${raw}" — took ${sz.raw}` };
    }
    return {
      mb: nums[0].value,
      note: `file size cell reads "${raw}" — more than one value and no unit to tell them apart; took ${nums[0].raw}`,
    };
  }

  const solo = nums.length === 1 ? nums[0] : null;
  if (solo && (solo.unit === "mbps" || solo.unit === "kbps" || solo.unit === "mbit/s" || solo.unit === "mbits")) {
    return { mb: solo.value, note: `file size column holds "${raw}", which is a bitrate` };
  }

  const n = firstNumber(raw);
  if (n === null) return { mb: null, note: "" };
  if (/\bg(b|ig)/i.test(raw)) return { mb: n * 1000, note: "" };
  if (/\bk(b|ilo)/i.test(raw)) return { mb: n / 1000, note: "" };
  if (/\bm(b|eg)/i.test(raw)) return { mb: n, note: "" };
  // No unit. A bare number in the thousands is almost certainly KB, but
  // "almost certainly" is not good enough to convert silently.
  if (n >= 1000) return { mb: n, note: `file size "${raw}" has no unit — KB?` };
  return { mb: n, note: "" };
}

/** -> Mbps. */
function normaliseBitrate(v: string): { mbps: number | null; note: string } {
  const raw = String(v || "").trim();
  if (!raw) return { mbps: null, note: "" };

  // TWO VALUES IN ONE CELL. Take the one the client labelled as a rate, and say
  // so -- "50MB / 8Mbps" is a real thing to find in a bitrate column, and
  // reading it as 50 Mbps would send a file out at six times the cap.
  const nums = cellNumbers(raw);
  if (nums.length > 1) {
    const rate = pickByUnit(nums, ["mbps", "kbps", "mbit/s", "mbits", "kbit/s"]);
    if (rate) {
      const mbps = /k/.test(rate.unit) ? rate.value / 1000 : rate.value;
      return { mbps, note: `bitrate cell reads "${raw}" — took ${rate.raw}` };
    }
    return {
      mbps: nums[0].value,
      note: `bitrate cell reads "${raw}" — more than one value and no unit to tell them apart; took ${nums[0].raw}`,
    };
  }

  // ONE value, wrong unit: "50MB" sitting in the bitrate column. The client
  // labelled it themselves, so this is reading the sheet rather than guessing
  // at it -- but it is still reported, never quietly relabelled.
  const solo = nums.length === 1 ? nums[0] : null;
  if (solo && (solo.unit === "mb" || solo.unit === "gb" || solo.unit === "kb")) {
    return { mbps: solo.value, note: `bitrate column holds "${raw}", which is a file size` };
  }
  if (solo && (solo.unit === "fps" || solo.unit === "hz")) {
    return { mbps: solo.value, note: `bitrate column holds "${raw}", which is a frame rate` };
  }

  const n = firstNumber(raw);
  if (n === null) return { mbps: null, note: "" };
  if (/\bk(b|ilo)/i.test(raw)) return { mbps: n / 1000, note: "" };
  if (/\bm(b|eg)/i.test(raw)) return { mbps: n, note: "" };
  if (n >= 1000) return { mbps: n / 1000, note: `bitrate "${raw}" read as kbps` };
  return { mbps: n, note: "" };
}

// Mirrors the website CsvPreviewModal's formattedData: keep only rows that
// carry a size or duration, then normalise each field.
/**
 * The Sound column reduced to "yes" | "no" | "" (silent).
 *
 * DELIBERATELY BIASED TOWARDS NO. Audio on a DOOH deliverable is rare, and a
 * file shipped with sound it shouldn't have is a redelivery, while a missing
 * "yes" costs one click. So:
 *
 *   - any negative word ANYWHERE in the cell wins first. "Sound: No" starts
 *     with the word "sound" and used to come back YES on a prefix test, which
 *     is the exact failure this ordering removes.
 *   - "yes" requires the WHOLE cell to be an affirmative. A cell that merely
 *     mentions sound is not a request for it.
 *   - anything else is "", and the caller treats that as no.
 */
function soundFromCell(cell: unknown): string {
  const v = String(cell == null ? "" : cell).trim().toLowerCase();
  if (v === "") return "";
  if (/\b(no|none|not|false|mos|silent|mute|muted|without|n\/a)\b/.test(v)) return "no";
  if (/^(y|yes|true|sound|audio|with sound|sound required)$/.test(v)) return "yes";
  return "";
}

export function reshapeSpecs(rawSpecs: RawSpec[], territory: string): SpecRow[] {
  const valid = rawSpecs.filter((r) => r.pixelWidth || r.pixelHeight || r.duration);

  const mapped = valid.map((row) => {
    const rawSize = `${row.pixelWidth || ""} ${row.pixelHeight || ""}`;
    const sizeNums = rawSize.match(/\d+/g);
    const size = sizeNums && sizeNums.length >= 2 ? `${sizeNums[0]}x${sizeNums[1]}` : rawSize.trim();

    let artwork = "DOOH";
    if (row.artworkType) {
      // DFOH must precede FOH — otherwise a "DFOH" cell matches its FOH tail.
      const m = row.artworkType.match(/(DOOH|DINTH|DFOH|FOH)/i);
      if (m) artwork = m[0].toUpperCase();
    }

    let duration = "";
    if (row.duration) {
      const m = String(row.duration).match(/[\d-]+/);
      if (m) duration = m[0];
    }

    const fs = normaliseFileSize(String(row.fileSize || ""));
    const br = normaliseBitrate(String(row.bitRate || ""));
    const fpsRaw = String(row.frameRate || "").trim();
    const fpsNums = cellNumbers(fpsRaw);
    const fpsNum = firstNumber(fpsRaw);
    // The fps column had no shape check at all, so a bitrate parked in it was
    // read as a frame rate and only caught later if the number happened to be
    // implausible. A written unit settles it outright.
    let fpsNote = "";
    if (fpsNums.length > 1) {
      fpsNote = `frame rate cell reads "${fpsRaw}" — more than one value; took ${fpsNums[0].raw}`;
    } else if (fpsNums.length === 1) {
      const u = fpsNums[0].unit;
      if (u === "mbps" || u === "kbps" || u === "mbit/s" || u === "mbits") {
        fpsNote = `frame rate column holds "${fpsRaw}", which is a bitrate`;
      } else if (u === "mb" || u === "gb" || u === "kb") {
        fpsNote = `frame rate column holds "${fpsRaw}", which is a file size`;
      }
    }

    const trim = (n: number) => String(Math.round(n * 1000) / 1000);

    return {
      Artwork: artwork,
      Campaign: row.campaignSelection ? String(row.campaignSelection).trim() : "",
      Size: size,
      Duration: duration,
      Country: territory || "UNKNOWN",
      Site: row.mediaSiteName ? String(row.mediaSiteName).replace(/\s+/g, " ").trim() : "",
      FileSize: fs.mb === null ? "" : trim(fs.mb),
      BitRate: br.mbps === null ? "" : trim(br.mbps),
      Fps: fpsNum === null ? "" : trim(fpsNum),
      // "Yes"/"No"/"Y"/"N"/"Sound"/"MOS" all occur; anything unrecognised
      // stays "" so an odd value is treated as "the sheet didn't say" rather
      // than silently becoming a no.
      Sound: soundFromCell(row.soundReq),
      // PARSE-TIME NOTES, which used to be computed and thrown away: every
      // normaliser returned a `note` and no caller ever read one, so "read as
      // kbps" and "no unit -- KB?" have been invisible all along. The
      // row-shape warnings are appended to these below.
      Flags: [fs.note, br.note, fpsNote].filter(Boolean).join(" · "),
    };
  });

  // A single Specs PDF is one batch of one campaign, so the ARTWORK SELECTION
  // value is effectively constant down the column. Column geometry occasionally
  // drops it on a row (a long centred name landing a hair outside its band), so
  // backfill any blank with the campaign the OTHER rows in this same PDF agree
  // on -- the dominant non-empty value -- instead of emitting "UNKNOWN".
  const counts: Record<string, number> = {};
  mapped.forEach((r) => {
    if (r.Campaign) counts[r.Campaign] = (counts[r.Campaign] || 0) + 1;
  });
  const dominant = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  return mapped.map((r) => {
    const withCampaign = { ...r, Campaign: r.Campaign || dominant || "UNKNOWN" };
    const parseNotes = withCampaign.Flags ? [withCampaign.Flags] : [];
    return {
        ...withCampaign,
        Flags: parseNotes.concat(specRowWarnings(withCampaign)).join(" · "),
    };
  });
}

/**
 * Warnings about a row's delivery spec. PURE, and computed from the row as it
 * stands -- so the panel can re-run it on an EDITED row and a warning simply
 * disappears once someone corrects the value it was complaining about.
 *
 * That is the whole design: these values come off PDFs that territories fill in
 * by hand, so nothing here ever rewrites a value, blocks a run, or excludes a
 * row. It points at what looks wrong and gets out of the way. The person
 * looking at the table is the authority, not the parser.
 */
export function specRowWarnings(row: SpecRow): string[] {
  const notes: string[] = [];
  const size = firstNumber(row.FileSize);
  const bitrate = firstNumber(row.BitRate);
  const fps = firstNumber(row.Fps);
  const secs = firstNumber(row.Duration);

  const fpsLooksWrong = fps !== null && fps >= 1 && !looksLikeFps(fps);

  // The classic swap: a frame rate sitting in the bitrate column. Only called
  // out when the fps column ISN'T already holding a sensible frame rate --
  // otherwise a genuine 25 Mbps beside a genuine 25 fps cries wolf on every row.
  // Only suspect a swap when there IS a frame-rate column holding something
  // wrong. Real data killed the looser version: Italy's specs PDF has no fps
  // column at all and a bitrate of 30 on every row -- a perfectly ordinary
  // 30 Mbps -- and the old rule flagged all 12. With no fps column there is
  // no swap to suspect, and a checker that fires on every row gets ignored
  // within a day.
  if (bitrate !== null && looksLikeFps(bitrate) && fps !== null && fpsLooksWrong) {
    notes.push(`bitrate reads "${row.BitRate}", which looks like a frame rate`);
  }
  if (fpsLooksWrong) {
    notes.push(`frame rate "${row.Fps}" isn't one we use`);
  }
  // A bare four-figure "size" is almost certainly KB -- but "almost certainly"
  // is not enough to convert on someone's behalf.
  if (size !== null && size >= 1000) {
    notes.push(`file size ${row.FileSize} looks like KB, not MB`);
    return notes; // the cross-check below would just restate this one
  }
  if (size !== null && bitrate !== null && secs && secs > 0) {
    const implied = (size * 8) / secs;
    if (implied > 0 && (bitrate > implied * 2.5 || bitrate < implied / 2.5)) {
      notes.push(
        `${bitrate}Mbps and ${size}MB over ${secs}s disagree ` +
        `(the size implies ~${implied.toFixed(1)}Mbps)`
      );
    }
  }
  return notes;
}

// ─── public: build the [METADATA]/CSV text csvLocaliserRun() parses ───────────

// APPEND-ONLY BEYOND COUNTRY. csvLocaliserRun() splits each row on commas and
// reads texLoc[0..3] positionally, so Artwork/Campaign/Size/Duration must keep
// their index. Everything after Country is carried along for the human reading
// the CSV and ignored by the host (a comma inside a site name only ever adds a
// trailing, ignored element for the same reason). Add new columns at the END.
//
// Flags is deliberately NOT here: it's a warning for the person looking at the
// specs table, not data for the localiser to consume.
const CSV_HEADERS: (keyof SpecRow)[] = [
  "Artwork", "Campaign", "Size", "Duration", "Country", "Site",
  "FileSize", "BitRate", "Fps",
];

// csvLocaliserRun() strips quotes before splitting on commas, so a quoted
// comma would still split a row — commas and newlines are replaced with a
// space here rather than escaped, so what the host parses always matches what
// this writes.
function csvCell(v: string): string {
  const flat = String(v || "").replace(/[\r\n,]+/g, " ").replace(/\s+/g, " ").trim();
  return `"${flat.replace(/"/g, "")}"`;
}

export function buildLocaliserCsv(opts: {
  territory: string;
  batch: string;
  sourceFolder: string;
  rows: SpecRow[];
}): string {
  const meta =
    `[METADATA]\n` +
    `Territory: ${opts.territory}\n` +
    `Batch: ${opts.batch}\n` +
    `Source Folder: ${opts.sourceFolder}\n` +
    `[/METADATA]\n\n`;

  const body = [
    CSV_HEADERS.join(","),
    ...opts.rows.map((r) => CSV_HEADERS.map((h) => csvCell(r[h])).join(",")),
  ].join("\n");

  return meta + body;
}

// "PP3_HRV_Batch_1.pdf" -> "Batch_1"; falls back to the bare stem so every PDF
// still yields a distinct batch name even when it doesn't follow the pattern.
export function batchNameFromFilename(fileName: string): string {
  const stem = fileName.replace(/\.pdf$/i, "");
  const m = stem.match(/batch[\s_-]*([0-9]+)/i);
  if (m) return `Batch_${m[1]}`;
  return stem;
}
