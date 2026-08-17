// =============================================================================
// src/js/main/lib/screenEnrich.ts
// -----------------------------------------------------------------------------
// Runs aep_screens.py over the library's template entries and brings back what
// each .aep can tell us about its screen -- crucially the REFERENCE IMAGE, the
// in-situ diagram an artist would otherwise go hunting for.
//
// WHY OUT OF PROCESS, same answer as masterCheck.ts: py-aep parses the .aep
// RIFX binary directly, which ExtendScript cannot do, and asking After Effects
// to open a few hundred templates just to look at them is the exact thing this
// toolbox exists to avoid. Nothing here opens, copies or writes a template.
//
// NOTHING SHIPS IN THE ZXP. The interpreter is the same venv the master check
// builds, and the script lives beside aep_layers.py in the team folder. This
// module is imported by the screen library only and nothing runs until the
// button is pressed -- do NOT add a mount-time probe, that would put a process
// spawn on every panel open.
//
// Degrades like every optional dependency here: if Python or the script is not
// on this machine, say what is missing and how to fix it. That is a normal
// state on a machine that has never run the setup, not an error.
//
// MEASURED YIELD, over the 224 templates in DOOH_Specs: 210 parse (94%), 146 of
// those give a reference image (70%) and 88 give usable slot geometry (42%).
// The slot half is deliberately NOT applied automatically -- see enrichScreens'
// note. A reference that is wrong costs one click; a wrong slot silently
// rearranges somebody's board.
// =============================================================================
import { child_process, fs, path, os } from "../../lib/cep/node";

/** The venv the master check's one-time setup builds. Keep in step with it. */
const VENV_PYTHON = "Library/Application Support/XYi/aep-tools/venv/bin/python";

/** Beside aep_layers.py. The folder is `_aep_tools`, with an UNDERSCORE. */
const SCRIPT_CANDIDATES = [
    "/Volumes/newmedia/_Motion/MotionAssets/_Scripts/Team_Folder/_aep_tools/aep_screens.py",
    "/Volumes/newmedia/_Motion/MotionAssets/_Personal/_Antonio/PYTHON_TEST/_aep_report/aep_screens.py",
];

export interface EnrichedSlot {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
}

export interface EnrichedScreen {
    path: string;
    ok: boolean;
    error?: string;
    comp?: string;
    width?: number;
    height?: number;
    duration?: number;
    depth?: number;
    /** The best pick. */
    reference?: string;
    /** Every plausible candidate, best first -- the panel lets the artist step
     *  through these, because the scoring is a heuristic and misses. */
    references?: { path: string; width: number; height: number; renderable: boolean }[];
    slots?: EnrichedSlot[];
}

export interface EnrichResult {
    ok: boolean;
    message: string;
    results?: EnrichedScreen[];
    /** True when the machine simply hasn't been set up, which reads differently
     *  from a real failure. */
    notInstalled?: boolean;
}

function homePath(rel: string): string {
    try {
        return path.join(os.homedir(), rel);
    } catch {
        return "";
    }
}

function exists(p: string): boolean {
    try {
        return !!p && fs.existsSync(p);
    } catch {
        return false;
    }
}

/** Cheap enough to call on a click, never on mount. */
export function findScript(): string {
    for (const candidate of SCRIPT_CANDIDATES) {
        if (exists(candidate)) return candidate;
    }
    return "";
}

export function isAvailable(): { ready: boolean; why: string } {
    if (typeof window === "undefined" || typeof (window as any).cep === "undefined") {
        return { ready: false, why: "Only works inside After Effects." };
    }
    if (!exists(homePath(VENV_PYTHON))) {
        return {
            ready: false,
            why: "Not set up on this Mac yet — run “Layer Report.command” once from the team folder, then come back.",
        };
    }
    if (!findScript()) {
        return { ready: false, why: "Can't find aep_screens.py — is the newmedia server mounted?" };
    }
    return { ready: true, why: "" };
}

/**
 * Reads every given .aep and returns what it found.
 *
 * The paths go through a TEMP FILE rather than argv: a few hundred NAS paths
 * with spaces and accents in them is exactly how an argv limit gets hit, and
 * one quoting mistake would silently read the wrong files.
 */
export function enrichScreens(
    aepPaths: string[],
    onProgress?: (line: string) => void
): Promise<EnrichResult> {
    return new Promise((resolve) => {
        const available = isAvailable();
        if (!available.ready) {
            resolve({ ok: false, message: available.why, notInstalled: true });
            return;
        }
        if (!aepPaths || aepPaths.length === 0) {
            resolve({ ok: false, message: "No templates to read." });
            return;
        }

        const python = homePath(VENV_PYTHON);
        const script = findScript();
        const listFile = path.join(
            os.tmpdir(),
            "xyi-screen-enrich-" + new Date().getTime() + ".txt"
        );

        try {
            fs.writeFileSync(listFile, aepPaths.join("\n"), "utf8");
        } catch (e: any) {
            resolve({ ok: false, message: "Couldn't stage the file list: " + (e?.message || String(e)) });
            return;
        }

        let child: any;
        try {
            child = child_process.spawn(python, [script, "--paths-from", listFile], {
                cwd: path.dirname(script),
            });
        } catch (e: any) {
            resolve({ ok: false, message: "Couldn't start the reader: " + (e?.message || String(e)) });
            return;
        }

        // stdout is the JSON payload and must be kept whole; stderr is the
        // per-file progress line. Keeping them apart is why the script writes
        // progress to stderr at all.
        let out = "";
        let errTail = "";
        child.stdout?.on("data", (buf: any) => { out += String(buf); });
        child.stderr?.on("data", (buf: any) => {
            const text = String(buf);
            errTail = (errTail + text).slice(-4000);
            if (!onProgress) return;
            for (const line of text.split("\n")) {
                const t = line.trim();
                if (t) onProgress(t);
            }
        });

        const cleanUp = () => {
            try { fs.unlinkSync(listFile); } catch { /* a temp file we can live without */ }
        };

        child.on("error", (e: any) => {
            cleanUp();
            resolve({ ok: false, message: "Couldn't run the reader: " + (e?.message || String(e)) });
        });

        child.on("close", (code: number) => {
            cleanUp();
            if (code !== 0) {
                const why = errTail.trim().split("\n").slice(-3).join(" ").trim();
                resolve({ ok: false, message: why || "The reader didn't finish (exit code " + code + ")." });
                return;
            }
            try {
                const parsed = JSON.parse(out);
                const results: EnrichedScreen[] = parsed && parsed.results ? parsed.results : [];
                resolve({ ok: true, message: "Read " + results.length + " templates.", results });
            } catch (e: any) {
                resolve({ ok: false, message: "Couldn't read the reader's output: " + (e?.message || String(e)) });
            }
        });
    });
}
