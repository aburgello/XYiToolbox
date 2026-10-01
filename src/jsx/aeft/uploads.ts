// =============================================================================
// src/jsx/aeft/uploads.ts
// -----------------------------------------------------------------------------
// WHERE A CAMPAIGN'S DELIVERIES ARE UPLOADED -- one folder per campaign, on
// another share entirely (`/Volumes/uploads/Upload_To_ENT_New/StreetFighter/
// Outdoor/DOOH`), with a territory and a batch folder under it. Nothing on the
// Markets tree says where it is, so it lived in people's heads and was typed
// into every delivery comment.
//
// So: a shared list, one entry per campaign, set once by whoever knows and
// read by everyone (`shared-upload-roots.json`). The Tracker's Message for
// Wrike fills `{upload.folder}` from it and links to it.
//
// KEYED BY THE MARKETS FOLDER'S OWN NAME (`XY026205_…_Markets`), never by its
// path or by a campaign's display name: the job number is the one thing every
// machine spells the same way, whatever the share is mounted as and whatever
// somebody called the campaign in their own list.
//
// The root is a path somebody PICKED, never derived. Read-only apart from
// that one list: nothing here creates, moves or writes into an uploads folder.
// =============================================================================
import { Result } from "./shared";
import { readSharedFile, writeSharedFile, teamFolder, loadLocalSetting, MACHINE_OWNER_KEY } from "./team";

const SHARED_UPLOADS_FILE = "shared-upload-roots.json";
const SHARED_UPLOADS_TYPE = "xyi-shared-upload-roots";

export interface UploadRoot {
  /** The Markets folder's name, upper-cased. */
  key: string;
  /** The Markets folder's name as the disk spells it, for a person reading the file. */
  campaign: string;
  root: string;
  author: string;
  stamp: string;
}

interface UploadRootsResult extends Result {
  entries?: UploadRoot[];
}

/** No file yet is not "could not read": the list starts life absent. An
 *  unmounted share is refused by teamFolder() before this is reached. */
function readUploadRoots(): UploadRoot[] {
  const raw = readSharedFile<UploadRoot>(SHARED_UPLOADS_FILE, SHARED_UPLOADS_TYPE);
  return raw === null ? [] : raw;
}

/** Every campaign's uploads root. No team folder is an EMPTY list, never an
 *  error: an unmounted share is a normal state, and the message just leaves
 *  the upload block out. */
export const uploadRootsLoad = (): UploadRootsResult => {
  try {
    if (!teamFolder()) return { success: true, entries: [] };
    return { success: true, entries: readUploadRoots() };
  } catch (e) {
    return { success: true, entries: [] };
  }
};

/** Set (or change) one campaign's uploads root, for everyone. */
export const uploadRootSet = (campaign: string, root: string): UploadRootsResult => {
  try {
    if (!teamFolder()) return { success: false, error: "The team folder isn't mounted, so this can't be shared right now." };
    const me = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!me) return { success: false, error: "This machine isn't tagged with your name yet -- set it in the Team menu first." };
    const key = String(campaign || "").toUpperCase();
    if (!key || !root) return { success: false, error: "Nothing to save." };

    const all = readUploadRoots();
    const entry: UploadRoot = { key: key, campaign: campaign, root: root, author: me, stamp: new Date().toString() };
    let replaced = false;
    for (let i = 0; i < all.length; i++) {
      if (String(all[i].key).toUpperCase() !== key) continue;
      all[i] = entry;
      replaced = true;
      break;
    }
    if (!replaced) all.push(entry);
    if (!writeSharedFile(SHARED_UPLOADS_FILE, SHARED_UPLOADS_TYPE, all)) {
      return { success: false, error: "Could not write to the team folder." };
    }
    return { success: true, entries: all };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** The folder dialog for it. "" on cancel, never an error. */
export const uploadRootPick = (campaign: string): string => {
  try {
    const folder = Folder.selectDialog("Pick the uploads folder for " + campaign + " (the one holding its territories):");
    return folder ? folder.fsName : "";
  } catch (e) {
    return "";
  }
};
