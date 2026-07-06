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

// =============================================================================
// findBestComponentFile -- ported from toolset/XYi_Detectives.jsx's
// findBestComponentFile(), a hybrid Jaccard + Levenshtein + Jaro-Winkler +
// numeric-token + substring scorer for matching one name against a list of
// name-carrying candidates. Originally ported into this codebase as a
// LOS-Tools-private helper (losFindBestComponentFile) before the studio's
// real XYi_Detectives.jsx (a shared module the studio's own Trotting
// Along 2.0/PDF to CSV/MC It!/Cheeky InvT Check all reuse) surfaced --
// promoted here, generic over any {name: string}-shaped candidate, so
// every one of those callers can share ONE implementation instead of each
// getting its own copy at a different fidelity level. File-matching
// callers (LOS Tools, MC It!) pass File[] (which already has a .name);
// name-only callers (territory lookup) pass plain {name, code} records --
// both satisfy the same generic constraint without a wrapper.
// =============================================================================
export function findBestComponentFile<T extends { name: string }>(targetName: string, candidates: T[]): T | null {
  const ACCEPT_THRESHOLD = 0.01;
  const NUMERIC_BOOST = 0.25;
  const SUBSTRING_BOOST = 0.15;

  function norm(s: string): string {
    if (!s) return "";
    s = (s + "").toLowerCase();
    s = s.replace(/\.[a-z0-9]{1,5}$/i, "");
    s = s.replace(/[^a-z0-9]+/g, " ");
    s = s.replace(/\s+/g, " ");
    return s.replace(/^\s+|\s+$/g, "");
  }
  function numbersIn(s: string): string[] {
    const m = (s + "").match(/\d+/g);
    if (!m) return [];
    const seen: Record<string, boolean> = {};
    const arr: string[] = [];
    for (let i = 0; i < m.length; i++) {
      if (!seen[m[i]]) {
        seen[m[i]] = true;
        arr.push(m[i]);
      }
    }
    return arr;
  }

  function jaccardHybrid(inputA: string, inputB: string): number {
    const JACCARD_WEIGHT = 0.7;
    const LEVENSHTEIN_WEIGHT = 0.3;
    function tokenize(filename: string): string[] {
      const cleanName = String(filename || "")
        .replace(/\.aep|_V\d+/gi, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2");
      const tokens = cleanName.toLowerCase().split(/[_\-\s]+/);
      const stopWords = ["dgtl", "digital", "master", "ov", "en", "the"];
      const finalTokens: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token && stopWords.indexOf(token) === -1 && !/^\d+x\d+$/.test(token)) finalTokens.push(token);
      }
      return finalTokens;
    }
    function levenshteinDistance(s: string, t: string): number {
      s = String(s || "");
      t = String(t || "");
      if (!s.length) return t.length;
      if (!t.length) return s.length;
      const arr: number[][] = [];
      for (let i = 0; i <= t.length; i++) {
        arr[i] = [];
        arr[i][0] = i;
      }
      for (let j = 0; j <= s.length; j++) arr[0][j] = j;
      for (let i = 1; i <= t.length; i++) {
        for (let j = 1; j <= s.length; j++) {
          const cost = s.charAt(j - 1) === t.charAt(i - 1) ? 0 : 1;
          let min = arr[i - 1][j] + 1;
          if (arr[i][j - 1] + 1 < min) min = arr[i][j - 1] + 1;
          if (arr[i - 1][j - 1] + cost < min) min = arr[i - 1][j - 1] + cost;
          arr[i][j] = min;
        }
      }
      return arr[t.length][s.length];
    }
    const tokensA = tokenize(inputA);
    const tokensB = tokenize(inputB);
    if (!tokensA.length && !tokensB.length) return 0;
    const setA: Record<string, boolean> = {};
    const setB: Record<string, boolean> = {};
    for (let i = 0; i < tokensA.length; i++) setA[tokensA[i]] = true;
    for (let j = 0; j < tokensB.length; j++) setB[tokensB[j]] = true;
    let intersection = 0;
    let union = 0;
    for (const k in setA) {
      union++;
      if (setB[k]) intersection++;
    }
    for (const k in setB) {
      if (!setA[k]) union++;
    }
    const jaccardScore = union === 0 ? 0 : intersection / union;
    let finalScore = jaccardScore;
    const cleanStrA = tokensA.join(" ");
    const cleanStrB = tokensB.join(" ");
    const maxLen = Math.max(cleanStrA.length, cleanStrB.length);
    if (maxLen > 0) finalScore = jaccardScore * JACCARD_WEIGHT + (1 - levenshteinDistance(cleanStrA, cleanStrB) / maxLen) * LEVENSHTEIN_WEIGHT;
    return finalScore;
  }

  function jaroWinkler(s1: string, s2: string): number {
    s1 = String(s1 || "");
    s2 = String(s2 || "");
    if (s1 === s2) return 1;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;
    const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
    const matches1: boolean[] = new Array(len1);
    const matches2: boolean[] = new Array(len2);
    let m = 0;
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, len2);
      for (let j = start; j < end; j++) {
        if (!matches2[j] && s1.charAt(i) === s2.charAt(j)) {
          matches1[i] = true;
          matches2[j] = true;
          m++;
          break;
        }
      }
    }
    if (m === 0) return 0;
    let t = 0;
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (matches1[i]) {
        while (!matches2[k]) k++;
        if (s1.charAt(i) !== s2.charAt(k)) t++;
        k++;
      }
    }
    t = t / 2.0;
    let jaro = (m / len1 + m / len2 + (m - t) / m) / 3.0;
    if (jaro > 0.7) {
      let prefix = 0;
      for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
        if (s1.charAt(i) === s2.charAt(i)) prefix++;
        else break;
      }
      jaro += prefix * 0.1 * (1 - jaro);
    }
    return jaro;
  }

  const targetNorm = norm(targetName);
  if (!targetNorm) return null;
  const targetNums = numbersIn(targetName);

  for (let e = 0; e < candidates.length; e++) {
    if (norm(candidates[e].name) === targetNorm) return candidates[e];
  }

  let best: T | null = null;
  let bestScore = -1;
  for (let c = 0; c < candidates.length; c++) {
    const cname = candidates[c].name;
    const cbase = norm(cname);
    const jaccardLevScore = jaccardHybrid(targetName, cname);
    const jwScore = jaroWinkler(targetNorm, cbase);
    const blendedBaseScore = jwScore * 0.6 + jaccardLevScore * 0.4;

    let substringBonus = 0;
    if (cbase.indexOf(targetNorm) !== -1 || targetNorm.indexOf(cbase) !== -1) substringBonus = SUBSTRING_BOOST;

    const cNums = numbersIn(cname);
    let numInter = 0;
    if (targetNums.length && cNums.length) {
      for (let a = 0; a < targetNums.length; a++) {
        for (let b = 0; b < cNums.length; b++) {
          if (targetNums[a] === cNums[b]) {
            numInter++;
            break;
          }
        }
      }
    }
    const numRatio = targetNums.length ? numInter / targetNums.length : 0;
    const score = blendedBaseScore + NUMERIC_BOOST * numRatio + substringBonus;
    if (score > bestScore) {
      bestScore = score;
      best = candidates[c];
    }
  }
  if (best && bestScore >= ACCEPT_THRESHOLD) return best;
  return best;
}