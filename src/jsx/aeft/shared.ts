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