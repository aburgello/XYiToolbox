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
}

// Mirrors the website CsvPreviewModal's formattedData: keep only rows that
// carry a size or duration, then normalise each field.
export function reshapeSpecs(rawSpecs: RawSpec[], territory: string): SpecRow[] {
  const valid = rawSpecs.filter((r) => r.pixelWidth || r.pixelHeight || r.duration);

  const mapped = valid.map((row) => {
    const rawSize = `${row.pixelWidth || ""} ${row.pixelHeight || ""}`;
    const sizeNums = rawSize.match(/\d+/g);
    const size = sizeNums && sizeNums.length >= 2 ? `${sizeNums[0]}x${sizeNums[1]}` : rawSize.trim();

    let artwork = "DOOH";
    if (row.artworkType) {
      const m = row.artworkType.match(/(DOOH|DINTH|FOH)/i);
      if (m) artwork = m[0].toUpperCase();
    }

    let duration = "";
    if (row.duration) {
      const m = String(row.duration).match(/[\d-]+/);
      if (m) duration = m[0];
    }

    return {
      Artwork: artwork,
      Campaign: row.campaignSelection ? String(row.campaignSelection).trim() : "",
      Size: size,
      Duration: duration,
      Country: territory || "UNKNOWN",
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

  return mapped.map((r) => ({ ...r, Campaign: r.Campaign || dominant || "UNKNOWN" }));
}

// ─── public: build the [METADATA]/CSV text csvLocaliserRun() parses ───────────

const CSV_HEADERS: (keyof SpecRow)[] = ["Artwork", "Campaign", "Size", "Duration", "Country"];

function csvCell(v: string): string {
  return `"${String(v || "").replace(/"/g, '""')}"`;
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
