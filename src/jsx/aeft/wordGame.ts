// Local (per-machine) state for the arcade's DAILY puzzles -- the word game
// (src/js/main/arcade/DailyWord.tsx) and the poster game
// (src/js/main/arcade/PosterDaily.tsx).
//
// One file, one key each. They share this file rather than getting one module
// apiece because the whole job is "read a string, write a string": two copies
// of that would be two places to drift.
//
// Only TODAY'S progress and a small streak record live here; the puzzle word
// is not stored, because it isn't secret and isn't per-machine -- both the
// panel and every teammate derive the same word from the date (see
// DailyWord.tsx's `puzzleForDay`). That's the whole reason the "sync" needs
// no server: nothing has to agree on anything except what day it is.
//
// The team-facing half (posting your result to the shared board) lives in
// team.ts instead, because it needs that file's Team Folder plumbing --
// `teamFolder()` / `readSharedFile` / `writeSharedFile` are private there and
// duplicating them here is exactly the kind of drift this codebase has been
// bitten by before.
//
// Storage convention matches everything else in this app: section
// "XYiToolbox", one key, JSON string. See CLAUDE.md's persistence note.
import { Result } from "./shared";

const WG_SETTINGS_SECTION = "XYiToolbox";
const WG_STATE_KEY = "WordGameState";

/**
 * Returns the stored JSON blob verbatim (or "" when nothing is saved yet).
 *
 * Deliberately opaque: this function does not parse or validate the shape.
 * The frontend owns the format and can evolve it freely without a matching
 * ExtendScript change -- the same "values are opaque strings" reasoning
 * PROFILE_KEYS uses in team.ts, and it keeps a corrupt/older blob from being
 * an ExtendScript-side error (the frontend just falls back to a fresh game).
 */
export const wordGameLoadState = (): string => {
  try {
    if (app.settings.haveSetting(WG_SETTINGS_SECTION, WG_STATE_KEY)) {
      return app.settings.getSetting(WG_SETTINGS_SECTION, WG_STATE_KEY);
    }
  } catch (e) {
    /* unreadable settings -- a fresh game is the right fallback */
  }
  return "";
};

export const wordGameSaveState = (stateJson: string): Result => {
  try {
    app.settings.saveSetting(WG_SETTINGS_SECTION, WG_STATE_KEY, stateJson);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- POSTER, the daily film-poster puzzle ------------------------------------
// Same contract as above, its own key: today's guesses, hints bought, and the
// streak. The film itself isn't stored for the same reason the word isn't --
// every machine derives it from the date (PosterDaily.tsx's `posterForDay`).
const PG_STATE_KEY = "PosterGameState";

export const posterGameLoadState = (): string => {
  try {
    if (app.settings.haveSetting(WG_SETTINGS_SECTION, PG_STATE_KEY)) {
      return app.settings.getSetting(WG_SETTINGS_SECTION, PG_STATE_KEY);
    }
  } catch (e) {
    /* unreadable settings -- a fresh game is the right fallback */
  }
  return "";
};

export const posterGameSaveState = (stateJson: string): Result => {
  try {
    app.settings.saveSetting(WG_SETTINGS_SECTION, PG_STATE_KEY, stateJson);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
