// =============================================================================
// src/jsx/aeft/research.ts
// -----------------------------------------------------------------------------
// EOC RESEARCH's host half: render ONE PASS of a campaign's renders down to a
// small mp4 and a last-frame still, and say what happened to each.
//
// It began as a saved Script Playground tool (Research_Renders.jsx v4) that
// did everything in one call: scan, manifest, a loop over every pass. The
// panel does the scanning and the manifest now, from its own Node, and asks
// for one pass at a time, because:
//   - a long run outlives the panel page (CLAUDE.md), so a single call for a
//     thousand renders came back to nobody; a pass is minutes, and what is
//     done is read off the destination folder, never off this call's answer;
//   - AE's engine is slow at listing folders and the panel's Node is not;
//   - File.exists lies on the share. The old tool marked a render it could
//     not see as DONE. Here the import is attempted and its failure is the
//     answer.
//
// THE PROJECT MUST BE EMPTY. A pass renders the WHOLE render queue and clears
// it afterwards, so on anybody's working project it would render and then
// remove their own queued items. `researchProjectState` says, the pass checks
// again, and nothing here ever saves.
//
// A MISSING OUTPUT MODULE TEMPLATE STOPS THE RUN. The old tool warned and
// carried on, which renders AE's default (a lossless .mov) under an .mp4 name
// a thousand times. Templates cannot be made by script.
// =============================================================================
import { SETTINGS_SECTION } from "./shared";

const RESEARCH_ROOT_KEY = "EocResearchRoot";
export const RESEARCH_DEFAULT_ROOT = "/Volumes/newmedia/_Motion/MotionAssets/Project_Research";

/** Where the archive lives on this machine: the studio's folder unless one was picked. */
export const researchGetRoot = (): string => {
  try {
    if (app.settings.haveSetting(SETTINGS_SECTION, RESEARCH_ROOT_KEY)) {
      const p = app.settings.getSetting(SETTINGS_SECTION, RESEARCH_ROOT_KEY);
      if (p) return p;
    }
  } catch (e) {}
  return RESEARCH_DEFAULT_ROOT;
};

export const researchSetRoot = (path: string): { success: boolean; error?: string } => {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, RESEARCH_ROOT_KEY, String(path || ""));
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

/** A folder dialog opening at `startAt`. "" on cancel, never an error. */
export const researchSelectFolder = (startAt: string, prompt: string): string => {
  try {
    const say = prompt || "Pick a folder";
    let picked: Folder | null = null;
    // Instance selectDlg: the static one opens wherever AE was last.
    if (startAt) picked = new Folder(startAt).selectDlg(say);
    else picked = Folder.selectDialog(say);
    return picked ? picked.fsName : "";
  } catch (e) {
    return "";
  }
};

interface ResearchProjectState {
  success: boolean;
  error?: string;
  items: number;
  queued: number;
  dirty: boolean;
  name: string;
}

export const researchProjectState = (): ResearchProjectState => {
  try {
    const f = app.project.file;
    return {
      success: true,
      items: app.project.numItems,
      queued: app.project.renderQueue.numItems,
      dirty: !!app.project.dirty,
      name: f ? decodeURI(f.name) : "",
    };
  } catch (e) {
    return { success: false, error: String(e), items: 0, queued: 0, dirty: false, name: "" };
  }
};

/** A new empty project, ONLY when nothing unsaved would be asked about. */
export const researchNewProject = (): { success: boolean; error?: string } => {
  try {
    if (app.project.dirty && (app.project.numItems > 0 || app.project.file)) {
      return { success: false, error: "The open project has unsaved changes. Save or close it first." };
    }
    app.newProject();
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

interface ResearchRowIn { prefix: string; src: string }
interface ResearchRowOut { prefix: string; ok: boolean; note: string }
interface ResearchPassResult {
  success: boolean;
  error?: string;
  /** Set when carrying on would repeat the same failure for every row. */
  fatal?: string;
  rows: ResearchRowOut[];
  seconds: number;
}

/**
 * One pass. `argsJson` is `{ dest, mp4Template, jpgTemplate, still, rows }`
 * as a JSON STRING: nested arrays of objects lose their values over the
 * bridge.
 *
 * `ok` is what the render queue reported. The panel still looks in `dest`
 * before it calls anything done.
 */
export const researchRenderChunk = (argsJson: string): ResearchPassResult => {
  const started = new Date().getTime();
  const out: ResearchRowOut[] = [];
  const took = () => Math.round((new Date().getTime() - started) / 1000);
  let bin: FolderItem | null = null;
  // Set once the queue is known to hold nothing but this pass's items: only
  // then may a failure clear it.
  let ours = false;
  try {
    const args = JSON.parse(String(argsJson || "{}"));
    const rows: ResearchRowIn[] = args.rows || [];
    const dest = String(args.dest || "");
    const mp4Template = String(args.mp4Template || "");
    const jpgTemplate = String(args.jpgTemplate || "");
    const wantStill = !!args.still;
    if (!dest || !rows.length || !mp4Template) return { success: false, error: "Nothing to render.", rows: out, seconds: 0 };

    const proj = app.project;
    if (proj.renderQueue.numItems > 0) {
      return { success: false, fatal: "The render queue is not empty. EOC Research renders the whole queue and clears it, so it only runs in an empty project.", rows: out, seconds: 0 };
    }

    ours = true;
    bin = proj.items.addFolder("RESEARCH_TEMP_" + started);
    const queued: { row: ResearchRowIn; mp4: RenderQueueItem; note: string }[] = [];
    let fatal = "";

    for (let i = 0; i < rows.length && !fatal; i++) {
      const row = rows[i];
      let fp: any = null;
      // The import IS the existence test: File.exists answers false for files
      // that are plainly there on the share.
      try {
        const io = new ImportOptions(new File(row.src));
        io.importAs = ImportAsType.FOOTAGE;
        fp = proj.importFile(io);
      } catch (e) {
        out.push({ prefix: row.prefix, ok: false, note: "Could not import the render: " + String(e) });
        continue;
      }
      let note = "";
      try {
        fp.parentFolder = bin;
        const fr = fp.frameRate && fp.frameRate > 0 ? fp.frameRate : 25;
        const comp = proj.items.addComp(row.prefix.substring(0, 200), Math.max(4, fp.width), Math.max(4, fp.height), fp.pixelAspect, Math.max(fp.duration, 1 / fr), fr);
        comp.parentFolder = bin;
        comp.layers.add(fp);

        const rqMp4 = proj.renderQueue.items.add(comp);
        const omMp4 = rqMp4.outputModule(1);
        try {
          omMp4.applyTemplate(mp4Template);
        } catch (e) {
          fatal = 'This machine has no Output Module template called "' + mp4Template + '". Add it in Edit > Templates > Output Module, then run again.';
          break;
        }
        omMp4.file = new File(dest + "/" + row.prefix + ".mp4");

        if (wantStill && jpgTemplate) {
          const rqJpg = proj.renderQueue.items.add(comp);
          const omJpg = rqJpg.outputModule(1);
          let stillOk = true;
          try {
            omJpg.applyTemplate(jpgTemplate);
          } catch (e) {
            stillOk = false;
            note = 'No "' + jpgTemplate + '" template: clip only, no still.';
            try { rqJpg.remove(); } catch (e2) {}
          }
          if (stillOk) {
            const fd = comp.frameDuration;
            const lastStart = Math.max(0, (Math.round(comp.duration / fd) - 1) * fd);
            app.beginSuppressDialogs();
            try {
              rqJpg.timeSpanDuration = fd; // shrink first, then move
              rqJpg.timeSpanStart = lastStart;
            } catch (e) {
              note = "The still's frame could not be set.";
            }
            app.endSuppressDialogs(false);
            // AE numbers a one-frame sequence whatever it is called. Asking
            // for the counter BEFORE the extension is what keeps it a .jpg:
            // left to itself it wrote `x_LASTFRAME.jpg00359`. The panel takes
            // the number off afterwards.
            omJpg.file = new File(dest + "/" + row.prefix + "_LASTFRAME_[#####].jpg");
          }
        }
        queued.push({ row: row, mp4: rqMp4, note: note });
      } catch (e) {
        out.push({ prefix: row.prefix, ok: false, note: "Could not queue it: " + String(e) });
      }
    }

    let renderError = "";
    if (!fatal && queued.length) {
      app.beginSuppressDialogs();
      try {
        proj.renderQueue.render();
      } catch (e) {
        renderError = String(e);
      }
      app.endSuppressDialogs(false);
    }

    for (let i = 0; i < queued.length; i++) {
      const q = queued[i];
      let done = false;
      try { done = q.mp4.status === RQItemStatus.DONE; } catch (e) {}
      if (fatal) out.push({ prefix: q.row.prefix, ok: false, note: "Not rendered." });
      else out.push({ prefix: q.row.prefix, ok: done, note: done ? q.note : (renderError || "The render did not finish.") });
    }

    // Back to an empty project, whatever happened above.
    try { while (proj.renderQueue.numItems > 0) proj.renderQueue.item(1).remove(); } catch (e) {}
    try { bin.remove(); bin = null; } catch (e) {}
    try { app.purge(PurgeTarget.ALL_CACHES); } catch (e) {}

    if (fatal) return { success: false, fatal: fatal, rows: out, seconds: took() };
    return { success: true, rows: out, seconds: took() };
  } catch (e) {
    try { while (ours && app.project.renderQueue.numItems > 0) app.project.renderQueue.item(1).remove(); } catch (e2) {}
    try { if (bin) bin.remove(); } catch (e3) {}
    return { success: false, error: String(e), rows: out, seconds: took() };
  }
};
