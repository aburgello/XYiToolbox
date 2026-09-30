// =============================================================================
// src/js/main/lib/finderLabels.ts
// -----------------------------------------------------------------------------
// The Finder colour on a file -- which the studio uses as a verdict: green or
// orange for a good render, red for a bad one.
//
// READ THROUGH CEP'S NODE, not ExtendScript, which has no way to see it. Two
// places hold it, both measured on the share (Hungary/Renders/Batch_02):
//   - com.apple.FinderInfo, byte 9, bits 1-3: the colour label as an index.
//     A V01 read 0x04 (Green), the V02 0x0E (Orange).
//   - com.apple.metadata:_kMDItemUserTags: a binary plist of "Name\nN" tags,
//     the newer form. Read as a fallback when FinderInfo has no label.
// `xattr` via execFile (never a shell string: filenames carry spaces and
// brackets), in parallel, each with a short timeout. Anything that fails --
// no attribute, an unmounted share, the browser preview -- is simply "none".
// =============================================================================
import { child_process } from "../../lib/cep/node";

export type FinderColor = "" | "gray" | "green" | "purple" | "blue" | "yellow" | "red" | "orange";

const BY_INDEX: FinderColor[] = ["", "gray", "green", "purple", "blue", "yellow", "red", "orange"];

/** A good render, by studio convention. */
export const isGoodColor = (c: FinderColor) => c === "green" || c === "orange";
/** A rejected render. */
export const isBadColor = (c: FinderColor) => c === "red";

/** FinderInfo as hex (`xattr -px` output, spaces/newlines allowed) -> colour. */
export function colorFromFinderInfo(hex: string): FinderColor {
    const h = String(hex || "").replace(/[^0-9a-f]/gi, "");
    if (h.length < 20) return "";
    const byte9 = parseInt(h.slice(18, 20), 16);
    return BY_INDEX[(byte9 >> 1) & 7] || "";
}

/** The user-tags plist, read as text: the first "\nN" colour index in it. */
export function colorFromUserTags(raw: string): FinderColor {
    const m = /\n([1-7])/.exec(String(raw || ""));
    return m ? BY_INDEX[parseInt(m[1], 10)] : "";
}

function xattr(args: string[]): Promise<string> {
    return new Promise((resolve) => {
        const ex = (child_process as any).execFile;
        if (typeof ex !== "function") { resolve(""); return; }
        try {
            ex.call(child_process, "/usr/bin/xattr", args, { timeout: 4000, encoding: "latin1" }, (err: any, out: any) => {
                resolve(err ? "" : String(out || ""));
            });
        } catch {
            resolve("");
        }
    });
}

async function colorOf(path: string): Promise<FinderColor> {
    const fromInfo = colorFromFinderInfo(await xattr(["-px", "com.apple.FinderInfo", path]));
    if (fromInfo) return fromInfo;
    return colorFromUserTags(await xattr(["-p", "com.apple.metadata:_kMDItemUserTags", path]));
}

/** Colour per path; paths with none are absent. Never throws. */
export async function readFinderColors(paths: string[]): Promise<Record<string, FinderColor>> {
    const out: Record<string, FinderColor> = {};
    const got = await Promise.all(paths.map((p) => colorOf(p).catch(() => "" as FinderColor)));
    paths.forEach((p, i) => { if (got[i]) out[p] = got[i]; });
    return out;
}

/** Open a file in its default app (QuickTime for a MOV), off the bridge. */
export function openInDefaultApp(path: string): boolean {
    const sp = (child_process as any).spawn;
    if (typeof sp !== "function") return false;
    try {
        const c = sp.call(child_process, "open", [path], { detached: true, stdio: "ignore" });
        if (c && typeof c.unref === "function") c.unref();
        return true;
    } catch {
        return false;
    }
}

/** Show a file selected in its Finder window (`open -R`), or open a folder.
 *  Off the bridge, and read-only: it opens a window, nothing else. */
export function revealInFinder(path: string, isFolder = false): boolean {
    const sp = (child_process as any).spawn;
    if (typeof sp !== "function") return false;
    try {
        const c = sp.call(child_process, "open", isFolder ? [path] : ["-R", path], { detached: true, stdio: "ignore" });
        if (c && typeof c.unref === "function") c.unref();
        return true;
    } catch {
        return false;
    }
}
