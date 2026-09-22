// =============================================================================
// src/jsx/aeft/sixtySeven.ts
// -----------------------------------------------------------------------------
// 67 -- the master for the comp you are in, with this creative's pitfalls
// pinned to the seconds they happen.
//
// The job it is for: checking your own work BEFORE it goes for review. The
// things that get missed are the ones somebody already knows about ("the date
// card clips on the 2L version"), and they are known by whoever hit them last
// week, not by whoever is looking now.
//
// EVERY LOOKUP IS ONE THE PANEL ALREADY DOES, deliberately: the comp's name is
// read by the same parser Cheeky T uses, the master is chosen by the same
// scorer CSV Localiser localises with, and the render is found the way OV
// Library finds it. A second way of answering "which master is this" is a
// second answer to disagree with the first.
//
// A MISSING RENDER IS NOT A FAILURE. Plenty of creatives have no mp4 where the
// library looks; the notes are the point, and they are returned either way.
// =============================================================================
import { Result } from "./shared";
import { parseFilenameMeta, getMastersIndex, pickBestMasterFromIndex, firstSizeToken } from "./tools";
import { loadCampaignsRaw, scanRendersForCreative, RenderEntry } from "./review";

export interface SixtySevenContext extends Result {
  /** What the comp's own name says. */
  compName?: string;
  creative?: string;
  size?: string;
  duration?: string;
  territory?: string;
  /** The campaign this creative belongs to, and where its masters live. */
  campaign?: string;
  mastersRoot?: string;
  /** The master this deliverable was built from, when one matches. */
  masterName?: string;
  masterPath?: string;
  /** The creative as the masters tree spells it -- what the render scan needs. */
  creativeFolder?: string;
  /** Playable renders for this creative, best guess first. Empty is normal. */
  renders?: { stem: string; path: string }[];
}

/** Canonical form for comparing a render's stem to a master's. */
function canon(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The FILM TITLE token a name starts with -- "SF", "FID", "ODY".
 *
 * TWO CAMPAIGNS CAN SHARE A CREATIVE NAME. Street Fighter has a Trio and so
 * does Forgotten Island, so creative + size + duration matched FID's master
 * from an SF comp: whichever campaign's index was walked first won, and the
 * panel then showed the wrong campaign's pitfalls. The prefix is what
 * separates them, and it is the one token both names always carry.
 */
function titleToken(name: string): string {
  const parts = String(name || "").split("_");
  return parts.length > 0 ? canon(parts[0]) : "";
}

/**
 * Everything 67 needs about the comp in front of you.
 *
 * Read-only throughout: this opens nothing, writes nothing and touches no
 * layer. It is a question, asked of the project and the masters index.
 */
export const sixtySevenContext = (): SixtySevenContext => {
  try {
    const item = app.project.activeItem;
    // Duck-typed: a CompItem is the thing with layers and a duration.
    if (!item || typeof (item as CompItem).numLayers !== "number") {
      return { success: false, error: "Open the comp you are working on first." };
    }
    const comp = item as CompItem;
    const meta = parseFilenameMeta(comp.name);
    const creative = meta.campaign || "";
    if (!creative) {
      return {
        success: false,
        error: '"' + comp.name + '" does not read as a deliverable name, so there is no creative to look up.',
      };
    }

    // The size and duration come off the comp's NAME rather than its
    // dimensions: a working comp is routinely a different size from the
    // deliverable it is building towards, and the name is what the master was
    // matched on in the first place.
    const size = meta.size || firstSizeToken(comp.name) || "";
    const duration = meta.duration || "";

    // WHICH CAMPAIGN. The creative token is matched against each saved
    // campaign's own masters, which is the same test the scorer uses -- a
    // campaign owns a token if its masters carry it.
    let campaign = "";
    let mastersRoot = "";
    let masterName = "";
    let masterPath = "";
    // The comp's own prefix. A master that does not share it belongs to
    // another campaign, however well the creative and the shape line up.
    const wantTitle = titleToken(comp.name);
    const camps = loadCampaignsRaw();
    for (let i = 0; i < camps.length; i++) {
      const root = camps[i].mastersRoot;
      if (!root) continue;
      let index;
      try {
        index = getMastersIndex(root);
      } catch (eIdx) {
        continue; // an unmounted share is a normal state, not an error
      }
      if (!index || index.length === 0) continue;
      const best = size && duration ? pickBestMasterFromIndex(index, creative, size, duration) : null;
      // REFUSED, not preferred: a Trio master under FID is not this comp's
      // master at all, and taking it would put another campaign's pitfalls in
      // front of somebody checking their own work.
      if (best && wantTitle && titleToken(best.name) !== wantTitle) continue;
      if (best) {
        campaign = camps[i].name;
        mastersRoot = root;
        masterName = best.name;
        masterPath = best.path;
        break;
      }
      // No master at this shape, but the campaign may still be the right one:
      // remember the first that carries the creative at all, and keep looking
      // for an exact match.
      if (!campaign) {
        const canonCreative = canon(creative);
        for (let j = 0; j < index.length; j++) {
          if (index[j].canonPath.indexOf(canonCreative) === -1) continue;
          // Same rule for the fallback: the campaign has to be one whose
          // masters carry this comp's prefix.
          if (wantTitle && titleToken(index[j].name) !== wantTitle) continue;
          campaign = camps[i].name;
          mastersRoot = root;
          break;
        }
      }
    }

    // THE CREATIVE AS THE DISK SPELLS IT, not as the filename does.
    //
    // scanRendersForCreative opens `<root>/Renders/<creative>` literally, so
    // the string has to be the FOLDER's name -- OV Library passes one it read
    // off disk, and 67 was passing the token out of the comp's name. "Trio"
    // against a folder called "TRIO" is a miss, and "PortalToParadise" against
    // "PORTAL_TO_PARADISE" is a worse one: the master was found, the render
    // was not, and the panel said there wasn't one.
    //
    // The master's own path is the answer -- it IS inside that folder.
    let creativeFolder = creative;
    if (masterPath && mastersRoot) {
      const rootFs = String(mastersRoot).replace(/[\/\\]+$/, "");
      if (masterPath.indexOf(rootFs) === 0) {
        const rel = masterPath.slice(rootFs.length + 1).split(/[\/\\]/);
        // A root pointed at the campaign rather than its AE folder.
        let first = rel.length > 0 ? rel[0] : "";
        if (String(first).toUpperCase() === "AE" && rel.length > 1) first = rel[1];
        if (first && rel.length > 1) creativeFolder = first;
      }
    }

    // The renders for this creative, with the one matching the master's own
    // stem first. Without a master, whatever the creative has.
    const renders: { stem: string; path: string }[] = [];
    if (mastersRoot) {
      let found: RenderEntry[] = [];
      try {
        found = scanRendersForCreative(mastersRoot, creativeFolder) || [];
      } catch (eScan) {
        found = [];
      }
      // Still nothing, and the folder we guessed was not the parsed token:
      // try that too rather than reporting "no render" on a spelling.
      if (found.length === 0 && creativeFolder !== creative) {
        try {
          found = scanRendersForCreative(mastersRoot, creative) || [];
        } catch (eScan2) {
          found = [];
        }
      }
      const wanted = canon(String(masterName).replace(/\.aep$/i, ""));
      for (let r = 0; r < found.length; r++) {
        if (wanted && canon(found[r].stem) === wanted) renders.push({ stem: found[r].stem, path: found[r].path });
      }
      for (let r = 0; r < found.length; r++) {
        const already = wanted && canon(found[r].stem) === wanted;
        if (!already) renders.push({ stem: found[r].stem, path: found[r].path });
      }
    }

    return {
      success: true,
      compName: comp.name,
      creative: creative,
      size: size,
      duration: duration,
      territory: meta.territory || "",
      campaign: campaign,
      mastersRoot: mastersRoot,
      masterName: masterName,
      masterPath: masterPath,
      creativeFolder: creativeFolder,
      renders: renders,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** What a dropped-in layer and its markers are called, so a second press
 *  replaces the first instead of stacking. */
const DROP_PREFIX = "67 · ";
const MARKER_PREFIX = "67: ";

export interface SixtySevenDropResult extends Result {
  markers?: number;
  clipAdded?: boolean;
  compName?: string;
}

/**
 * Put the master's render over the comp you are in, and its pitfalls on the
 * comp's own marker track.
 *
 * WHY BOTH. The clip is for comparing against; the markers are for the rest of
 * the day, when the panel is closed and you are working. Markers are where
 * artists already look, which is the whole reason this is not just a player.
 *
 * TWO THINGS KEEP IT SAFE TO PRESS TWICE. The layer is a GUIDE layer -- it
 * never renders, so a forgotten one cannot reach a deliverable -- and both the
 * layer and the markers carry a "67" prefix, so a second press replaces what
 * the first one left rather than stacking a second copy.
 *
 * `notesJson` is a JSON STRING: an array of objects spliced into eval'd
 * ExtendScript source loses its values in transit (CLAUDE.md).
 */
export const sixtySevenDropIn = (renderPath: string, notesJson: string): SixtySevenDropResult => {
  let undoOpen = false;
  try {
    const item = app.project.activeItem;
    if (!item || typeof (item as CompItem).numLayers !== "number") {
      return { success: false, error: "Open the comp you are working on first." };
    }
    const comp = item as CompItem;

    let notes: { text: string; at: number }[] = [];
    if (notesJson) {
      try {
        notes = JSON.parse(notesJson) as { text: string; at: number }[];
      } catch (eParse) {
        notes = [];
      }
    }

    app.beginUndoGroup("XYi 67 — drop in");
    undoOpen = true;

    // --- the clip -----------------------------------------------------------
    let clipAdded = false;
    if (renderPath) {
      // Anything this tool left last time goes first, so pressing twice does
      // not build a stack of the same clip.
      for (let i = comp.numLayers; i >= 1; i--) {
        const l = comp.layer(i);
        if (String(l.name).indexOf(DROP_PREFIX) === 0) l.remove();
      }

      const f = new File(renderPath);
      // NOT gated on File.exists: it answers false for files that are plainly
      // on the studio NAS (CLAUDE.md). Attempt the import and let it fail.
      let footage: FootageItem | null = null;
      try {
        const io = new ImportOptions(f);
        footage = app.project.importFile(io) as FootageItem;
      } catch (eImp) {
        footage = null;
      }
      if (footage) {
        const layer = comp.layers.add(footage) as AVLayer;
        layer.name = DROP_PREFIX + String(footage.name).replace(/\.[A-Za-z0-9]{1,5}$/, "");
        layer.moveToBeginning();
        // A GUIDE LAYER, so it cannot render into anything. The comparison is
        // for eyes, and a reference left in a delivery is the failure this
        // whole button would otherwise invite.
        (layer as any).guideLayer = true;
        // Contained, not cropped: the master is routinely a different shape
        // from the deliverable, and the point is to see all of it.
        const w = (footage as any).width || comp.width;
        const h = (footage as any).height || comp.height;
        let fit = Math.min(comp.width / w, comp.height / h) * 100;
        if (!fit || fit <= 0) fit = 100;
        const scale = layer.property("ADBE Transform Group").property("ADBE Scale") as Property;
        scale.setValue([fit, fit]);
        const pos = layer.property("ADBE Transform Group").property("ADBE Position") as Property;
        pos.setValue([comp.width / 2, comp.height / 2]);
        clipAdded = true;
      }
    }

    // --- the markers --------------------------------------------------------
    // Ours are removed first, by comment prefix, so somebody else's markers on
    // the same comp are never touched.
    const mp = comp.markerProperty;
    for (let k = mp.numKeys; k >= 1; k--) {
      const mv = mp.keyValue(k) as MarkerValue;
      const comment = mv && mv.comment ? String(mv.comment) : "";
      if (comment.indexOf(MARKER_PREFIX) === 0) mp.removeKey(k);
    }

    let added = 0;
    for (let n = 0; n < notes.length; n++) {
      const at = Number(notes[n].at);
      if (isNaN(at) || at < 0) continue;
      // Past the end of the comp is a marker nobody can see; clamped rather
      // than dropped, because the note still applies to the last frame.
      const t = at > comp.duration ? comp.duration : at;
      mp.setValueAtTime(t, new MarkerValue(MARKER_PREFIX + String(notes[n].text || "")));
      added++;
    }

    app.endUndoGroup();
    undoOpen = false;

    if (!clipAdded && added === 0) {
      return { success: false, error: "Nothing to add: no playable render, and no notes with a time on them." };
    }
    return {
      success: true,
      clipAdded: clipAdded,
      markers: added,
      compName: comp.name,
      message: (clipAdded ? "Clip added as a guide layer" : "No clip added")
        + (added > 0 ? ", " + added + " marker" + (added === 1 ? "" : "s") + " on the comp." : "."),
    } as SixtySevenDropResult;
  } catch (e) {
    if (undoOpen) { try { app.endUndoGroup(); } catch (e2) {} }
    return { success: false, error: e.toString() };
  }
};
