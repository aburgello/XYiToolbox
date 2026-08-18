// =============================================================================
// src/jsx/aeft/agentWrites.ts
// -----------------------------------------------------------------------------
// THE ONLY FUNCTIONS THE ASK AGENT MAY CALL THAT CHANGE ANYTHING.
//
// Its own file so the answer to "what can the agent do to my project?" is one
// file long. Everything else it holds reads, scans, navigates, or fills a form;
// this is the whole of the other half, and it should stay short enough to read
// in a sitting.
//
// WHAT MAKES THESE SAFE IS NOT THAT THEY ARE SMALL -- IT IS THAT WE WROTE THEM.
// The alternative design is handing the model `runScript` and letting it author
// ExtendScript against the artist's open project. That is rejected outright
// (CLAUDE.md section 1, and docs/AGENT-READONLY-SLICE.md): a generated script
// can do anything the engine can, including overwrite a studio master, and the
// only gate would be somebody skimming code they did not write. A function like
// createComp cannot save over a master because saving is not in it.
//
// It also sidesteps the dialect problem entirely. A small model writing
// ExtendScript reaches for modern JavaScript on an ES3 engine and fails
// quietly; here the ExtendScript is written once, by hand, and reviewed, and
// the model only supplies arguments.
//
// RULES FOR ANYTHING ADDED HERE
//
//   1. ONE UNDO GROUP per call, so the worst case is one Ctrl+Z. If an action
//      cannot be expressed that way it does not belong in this file.
//   2. NEVER TOUCH A FILE. No open, no save, no import, no render queue. These
//      act on the project in memory and nothing else.
//   3. VALIDATE EVERY ARGUMENT, and bound it. The caller is a language model:
//      treat every number as hostile, not merely wrong.
//   4. RETURN {success, error} -- never throw across the bridge.
//   5. SAY WHAT HAPPENED, in the return, in words the agent can repeat to the
//      artist without embellishing.
// =============================================================================
import { Result } from "./shared";

/** AE's own limits. A comp outside these is refused by AE anyway, with a worse message. */
const MIN_DIM = 4;
const MAX_DIM = 30000;
const MIN_FPS = 1;
const MAX_FPS = 999;
const MAX_SECONDS = 10800; // three hours; past this it is a typo, not a comp

interface CreateCompResult extends Result {
  name?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  seconds?: number;
  /** Exactly what reverses it, for the agent to repeat verbatim. */
  undo?: string;
}

/**
 * A new, empty composition in the open project.
 *
 * Undoable in one step and touches nothing on disk -- the two properties that
 * let the agent call it at all.
 *
 * NOT SELECTED OR OPENED afterwards, deliberately. Stealing the artist's
 * viewer while they are working somewhere else is the kind of small violence
 * that makes a tool feel unsafe, and "I made it, it's in your project panel"
 * is a complete answer.
 */
export const agentCreateComp = (
  name: string,
  width: number,
  height: number,
  frameRate: number,
  seconds: number
): CreateCompResult => {
  try {
    if (!app || !app.project) {
      return { success: false, error: "No project is open in After Effects." };
    }

    // Trimmed, then checked for emptiness: a name of spaces produces a comp
    // nobody can find in the project panel.
    const compName = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "");
    if (!compName) return { success: false, error: "The comp needs a name." };

    // Number() on a non-numeric string is NaN, and every comparison against NaN
    // is false -- so each bound is written to REJECT rather than to accept, and
    // NaN falls through to the error rather than past it.
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (!(w >= MIN_DIM && w <= MAX_DIM)) {
      return { success: false, error: "Width must be a number between " + MIN_DIM + " and " + MAX_DIM + "." };
    }
    if (!(h >= MIN_DIM && h <= MAX_DIM)) {
      return { success: false, error: "Height must be a number between " + MIN_DIM + " and " + MAX_DIM + "." };
    }

    const fps = Number(frameRate);
    if (!(fps >= MIN_FPS && fps <= MAX_FPS)) {
      return { success: false, error: "Frame rate must be a number between " + MIN_FPS + " and " + MAX_FPS + "." };
    }

    const dur = Number(seconds);
    if (!(dur > 0 && dur <= MAX_SECONDS)) {
      return { success: false, error: "Duration must be a positive number of seconds, up to " + MAX_SECONDS + "." };
    }

    // ONE GROUP AROUND THE WHOLE THING. Opened before the first change and
    // closed in `finally`, so an exception mid-way cannot leave AE with a
    // group open -- which silently swallows the artist's NEXT action into it.
    app.beginUndoGroup("Ask: create comp " + compName);
    let comp: CompItem;
    try {
      // Pixel aspect 1: the studio delivers square-pixel DOOH, and a
      // non-square PAR is a decision nobody asked the agent to make.
      comp = app.project.items.addComp(compName, w, h, 1, dur, fps);
    } finally {
      app.endUndoGroup();
    }

    if (!comp) return { success: false, error: "After Effects did not create the comp." };

    return {
      success: true,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      // Read back off the COMP, not echoed from the arguments: AE quantises
      // duration to the frame, so 10s at 25fps is what AE says it is, and
      // reporting the request rather than the result is how a tool ends up
      // claiming something that is not quite true.
      frameRate: comp.frameRate,
      seconds: comp.duration,
      undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects.",
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
