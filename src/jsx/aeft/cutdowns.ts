// =============================================================================
// src/jsx/aeft/cutdowns.ts
// -----------------------------------------------------------------------------
// CUT-DOWNS -- the lengths that became masters without being masters.
//
// Australia needs a 7s, somebody builds one, and three weeks later Peru needs
// a 7s too. Today that knowledge lives in a message: "Australia batch 3 is my
// Peru master". Nothing on disk says it, the masters index has never heard of
// it, and the next person asks in the chat again.
//
// So: a shared list, one entry per cut-down, pointing at the .aep that IS the
// length. Registered by hand and deliberately -- a folder full of deliverables
// is not a shelf of masters, and only a person can say which of them became
// one.
//
// WHAT IT IS NOT: it is not a second masters index. Nothing here is ever
// preferred over a real master; a cut-down is only ever offered for a
// length the masters tree cannot answer at all (see cutdownsFor).
//
// THE ARTWORK IS THE CATCH, and it is the caller's to handle. A real master is
// OV, so MC It! and Support Swap know which token to swap FROM. A cut-down is
// already localised -- Peru's 7s carries _PE_ -- and those tools refuse a
// market-to-market swap on purpose (CLAUDE.md: a mistake and a deliberate
// borrow look identical). Building from one therefore copies and renames
// correctly, imports the territory's images as usual, and leaves the artwork
// swap to a person. Anything else would put Peru's artwork in a Cyprus file.
// =============================================================================
import { Result } from "./shared";
import { parseFilenameMeta } from "./tools";
import { readSharedFile, writeSharedFile, teamFolder, loadLocalSetting, MACHINE_OWNER_KEY } from "./team";

const SHARED_CUTDOWNS_FILE = "shared-cutdowns.json";
const SHARED_CUTDOWNS_TYPE = "xyi-shared-cutdowns";

export interface Cutdown {
  id: string;
  /** As the campaign list spells it. */
  campaign: string;
  /** As the creative's own filenames spell it. */
  creative: string;
  /** Bare digits: "7", "12". One length per entry. */
  duration: string;
  /** "1080x1920", off the filename. */
  size: string;
  /** The territory it was built for -- the token an artwork swap would have
   *  to work FROM, which is why it is recorded rather than derived later. */
  territory: string;
  /** The .aep itself, and the folder it sits in. */
  path: string;
  name: string;
  folder: string;
  author: string;
  stamp: string;
  /** What changed to make this length -- the half a filename cannot carry. */
  note?: string;
}

export interface CutdownsResult extends Result {
  entries?: Cutdown[];
}

export interface CutdownScanResult extends Result {
  /** Everything in the folder that reads as this creative, whatever length. */
  found?: Cutdown[];
  /** The folder as picked, for the report. */
  folder?: string;
}

function canon(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Bare digits, so "7", "7s" and "7sec" are one length. */
function durKey(s: string): string {
  return String(s || "").replace(/[^0-9]/g, "");
}

/**
 * NO FILE YET IS NOT "COULD NOT READ". readSharedFile returns null for both,
 * and this list starts life absent -- so the first registration on a fresh
 * team folder failed with "is the NAS mounted?" on a mounted NAS. The
 * unmounted case is already caught by teamFolder() at every call site, which
 * leaves null meaning "nobody has registered one".
 */
function readCutdowns(): Cutdown[] {
  const raw = readSharedFile<Cutdown>(SHARED_CUTDOWNS_FILE, SHARED_CUTDOWNS_TYPE);
  return raw === null ? [] : raw;
}

/** Everything registered. An unmounted share is refused above; beyond that,
 *  empty means nobody has registered one. */
export const cutdownsLoad = (): CutdownsResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    return { success: true, entries: readCutdowns() };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * What a folder holds for this creative.
 *
 * Read-only: it lists candidates and nothing else. Registering is a separate
 * press, because a batch folder holds every length the territory ordered and
 * only a person knows which of them is worth keeping as a master.
 *
 * ONE LEVEL, then each subfolder: a batch folder is `AE/Batch_01/*.aep` in
 * some markets and `AE/Batch_01/<deliverable>/*.aep` in others, and asking
 * somebody to point twice would be asking them to know which.
 */
export const cutdownsScanFolder = (folderPath: string, campaign: string, creative: string): CutdownScanResult => {
  try {
    if (!folderPath) return { success: false, error: "No folder picked." };
    const folder = new Folder(folderPath);
    // .exists is only trustworthy on a DIRECTORY (CLAUDE.md), which this is.
    if (!folder.exists) return { success: false, error: "That folder is not there:\n" + folderPath };

    const wantCreative = canon(creative);
    const found: Cutdown[] = [];
    const me = loadLocalSetting(MACHINE_OWNER_KEY) || "";

    const consider = (f: File, inFolder: Folder) => {
      const nm = String(f.name);
      if (nm.slice(-4).toLowerCase() !== ".aep") return;
      if (nm.indexOf("Auto-Save") !== -1) return;
      const meta = parseFilenameMeta(nm);
      if (!meta.campaign) return;
      if (canon(meta.campaign) !== wantCreative) return;
      found.push({
        id: "cut-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000) + "-" + found.length,
        campaign: campaign,
        creative: creative,
        duration: durKey(meta.duration),
        size: meta.size || "",
        territory: meta.territory || "",
        path: f.fsName,
        name: nm,
        folder: inFolder.fsName,
        author: me,
        stamp: new Date().toString(),
      });
    };

    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // Duck-typed: a Folder is the thing that can list itself.
      if (typeof (it as Folder).getFiles === "function") {
        const sub = it as Folder;
        const nm = String(sub.name);
        if (nm.charAt(0) === "_" || nm.indexOf("Auto-Save") !== -1) continue;
        const inner = sub.getFiles();
        for (let j = 0; j < inner.length; j++) {
          if (typeof (inner[j] as Folder).getFiles === "function") continue;
          consider(inner[j] as File, sub);
        }
      } else {
        consider(it as File, folder);
      }
    }

    return { success: true, found: found, folder: folder.fsName };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Register cut-downs. `entriesJson` is a JSON STRING of Cutdown objects --
 * nested arrays of objects do not survive the bridge (CLAUDE.md).
 *
 * Replaces by campaign+creative+duration+size: registering the same length
 * twice means the second one is the answer, not that there are two.
 */
export const cutdownsAdd = (entriesJson: string): CutdownsResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    const me = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!me) return { success: false, error: "This machine isn't tagged with your name yet -- set it in the Team menu first." };

    let incoming: Cutdown[] = [];
    try {
      incoming = JSON.parse(entriesJson) as Cutdown[];
    } catch (eParse) {
      return { success: false, error: "Could not read the cut-downs." };
    }
    if (!incoming || incoming.length === 0) return { success: false, error: "Nothing to register." };

    const all = readCutdowns();

    for (let i = 0; i < incoming.length; i++) {
      const c = incoming[i];
      if (!c || !c.path || !c.creative) continue;
      if (!c.author) c.author = me;
      if (!c.stamp) c.stamp = new Date().toString();
      let replaced = false;
      for (let j = 0; j < all.length; j++) {
        const same = canon(all[j].campaign) === canon(c.campaign)
          && canon(all[j].creative) === canon(c.creative)
          && durKey(all[j].duration) === durKey(c.duration)
          && canon(all[j].size) === canon(c.size);
        if (!same) continue;
        c.id = all[j].id;
        all[j] = c;
        replaced = true;
        break;
      }
      if (!replaced) all.push(c);
    }

    if (!writeSharedFile(SHARED_CUTDOWNS_FILE, SHARED_CUTDOWNS_TYPE, all)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, entries: all };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const cutdownsRemove = (id: string): CutdownsResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    const all = readCutdowns();
    const out: Cutdown[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].id !== id) out.push(all[i]);
    }
    if (out.length === all.length) return { success: false, error: "That cut-down is no longer registered." };
    if (!writeSharedFile(SHARED_CUTDOWNS_FILE, SHARED_CUTDOWNS_TYPE, out)) {
      return { success: false, error: "Could not write to the team folder." };
    }
    return { success: true, entries: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * The cut-downs that could answer one row, best first.
 *
 * ONLY WHEN THE MASTERS TREE CANNOT. The caller asks this for a row that found
 * no master, which is the whole design: a registered 7s never competes with a
 * real 7s master, it fills the hole where there is none.
 *
 * Size is a preference, not a filter -- a 7s at another shape is still the
 * only 7s of this creative anybody has, and the localiser scales anyway.
 */
export const cutdownsFor = (campaign: string, creative: string, size: string, duration: string): CutdownsResult => {
  try {
    const all = readCutdowns();
    const wantDur = durKey(duration);
    const wantSize = canon(size);
    const exact: Cutdown[] = [];
    const other: Cutdown[] = [];
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (canon(c.creative) !== canon(creative)) continue;
      if (campaign && c.campaign && canon(c.campaign) !== canon(campaign)) continue;
      if (wantDur && durKey(c.duration) !== wantDur) continue;
      if (wantSize && canon(c.size) === wantSize) exact.push(c);
      else other.push(c);
    }
    return { success: true, entries: exact.concat(other) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
