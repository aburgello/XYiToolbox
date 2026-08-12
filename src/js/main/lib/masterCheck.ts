// =============================================================================
// src/js/main/lib/masterCheck.ts
// -----------------------------------------------------------------------------
// Runs the Python master-check (aep_layers.py) over a campaign's masters and
// opens the HTML report in the browser.
//
// WHY PYTHON, AND WHY OUT OF PROCESS. The check reads every master's .aep
// binary with py-aep, without opening After Effects. ExtendScript can't read
// those bytes and AE itself can't be asked to open 100 masters just to look at
// them -- that's the whole constraint this toolbox exists around. So the work
// happens in a separate process and the panel only launches it.
//
// NOTHING SHIPS IN THE ZXP. py-aep and its dependencies are ~29 MB living in a
// venv under the user's own home. The panel bundle is unchanged and the panel's
// start-up is untouched: this module is only imported by OV Library, and
// nothing here runs until the button is pressed. Do NOT add a mount-time probe
// for Python -- that would put a process spawn on every panel open.
//
// The report is written LOCALLY, never into the masters tree. Partly because
// that tree is sacred, partly because a NAS folder the panel can't write to
// would fail for one artist and not another.
//
// Degrades the way every optional dependency in this panel does: if Python or
// the script isn't on this machine, say what's missing and how to fix it. It is
// a normal state on a machine that has never run the setup, not an error.
// =============================================================================
import { child_process, fs, path, os } from "../../lib/cep/node";

/** Where the launcher's one-time setup puts the interpreter. Keep in step with
 *  `Layer Report.command` — both build the same venv in the same place. */
const VENV_PYTHON = "Library/Application Support/XYi/aep-tools/venv/bin/python";

/** Reports live beside the venv, one folder per campaign. */
const REPORT_ROOT = "Library/Application Support/XYi/aep-tools/reports";

/** Where aep_layers.py might be, best first. The team folder is the intended
 *  home; the second is where it was first built.
 *
 *  THE UNDERSCORE ON `_aep-tools` IS LOAD-BEARING. teamListProfiles (team.ts)
 *  enumerates every subfolder of Team_Folder as a team MEMBER and skips only
 *  `_`-prefixed ones — a folder called `aep-tools` would show up in the Team
 *  menu as a person named "aep-tools" with "no setup yet". Don't rename it. */
const SCRIPT_CANDIDATES = [
    "/Volumes/newmedia/_Motion/MotionAssets/_Scripts/Team_Folder/_aep-tools/aep_layers.py",
    "/Volumes/newmedia/_Motion/MotionAssets/_Personal/_Antonio/PYTHON_TEST/_aep_report/aep_layers.py",
];

export interface MasterCheckResult {
    ok: boolean;
    /** Shown to the user verbatim. */
    message: string;
    /** Present on success. */
    reportPath?: string;
    /** True when the machine simply hasn't been set up yet — worth a different
     *  message from a real failure. */
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
        return { ready: false, why: "Can't find aep_layers.py — is the newmedia server mounted?" };
    }
    return { ready: true, why: "" };
}

/**
 * Runs the check. `onProgress` receives the script's own stdout lines so the
 * button can show what it's doing — a 100-master campaign takes ~20 seconds
 * cold and a silent button for that long reads as a hang.
 */
export function runMasterCheck(
    campaignName: string,
    mastersRoot: string,
    onProgress?: (line: string) => void
): Promise<MasterCheckResult> {
    return new Promise((resolve) => {
        const available = isAvailable();
        if (!available.ready) {
            resolve({ ok: false, message: available.why, notInstalled: true });
            return;
        }

        const python = homePath(VENV_PYTHON);
        const script = findScript();
        // Campaign name goes into a folder name, so strip anything that would
        // make a mess of a path.
        const safeName = (campaignName || "campaign").replace(/[^A-Za-z0-9._ -]/g, "_").trim() || "campaign";
        const outDir = path.join(homePath(REPORT_ROOT), safeName);

        let child: any;
        try {
            child = child_process.spawn(python, [script, mastersRoot, "--out", outDir, "--quiet"], {
                cwd: path.dirname(script),
            });
        } catch (e: any) {
            resolve({ ok: false, message: "Couldn't start the check: " + (e?.message || String(e)) });
            return;
        }

        let tail = "";
        const note = (buf: any) => {
            const text = String(buf);
            tail = (tail + text).slice(-4000);
            if (!onProgress) return;
            for (const line of text.split("\n")) {
                const t = line.trim();
                if (t) onProgress(t);
            }
        };
        child.stdout?.on("data", note);
        child.stderr?.on("data", note);

        child.on("error", (e: any) => {
            resolve({ ok: false, message: "Couldn't run the check: " + (e?.message || String(e)) });
        });

        child.on("close", (code: number) => {
            const report = path.join(outDir, "report.html");
            if (code !== 0 || !exists(report)) {
                // The script prints its own reason; show the tail rather than a
                // generic failure, so a broken run is diagnosable from the panel.
                const why = tail.trim().split("\n").slice(-3).join(" ").trim();
                resolve({
                    ok: false,
                    message: why || "The check didn't finish (exit code " + code + ").",
                });
                return;
            }
            resolve({ ok: true, message: "Report ready.", reportPath: report });
        });
    });
}

/** Opens the finished report in the default browser. */
export function openReport(reportPath: string): void {
    try {
        // `open` rather than a file:// URL: CEP's own browser handoff is
        // inconsistent with local files, and every machine here is a Mac.
        child_process.spawn("open", [reportPath], { detached: true });
    } catch {
        try {
            (window as any).cep?.util?.openURLInDefaultBrowser("file://" + reportPath);
        } catch {
            /* nothing more we can do; the caller reports the path */
        }
    }
}
