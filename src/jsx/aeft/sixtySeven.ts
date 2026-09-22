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
