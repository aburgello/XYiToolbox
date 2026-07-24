// DOOM. Yes, really.
//
// An easter egg: typing the exact word "doom" into the home screen's search
// box reveals a launch card (see HomeScreen.tsx), and launching it mounts
// this component as a full-panel overlay running actual DOOM (shareware
// episode 1) compiled to WebAssembly.
//
// WHAT THIS IS: Cloudflare's `doom-wasm` build (a WASM port of
// chocolate-doom, itself GPL-2.0) plus the freely-redistributable shareware
// DOOM1.WAD. Both live verbatim in `src/js/public/doom/` -- see the
// LICENSING note at the bottom of this comment.
//
// THREE NON-OBVIOUS THINGS, all of which will silently break this if
// "cleaned up":
//
// 1. THE GLUE RUNS INSIDE A WRAPPER THAT TAKES `Module` AS A PARAMETER.
//    Two opposing constraints meet here, and only this shape satisfies both.
//    (a) Emscripten's glue starts with `var Module = typeof Module !=
//    "undefined" ? Module : {}` -- it adopts a pre-existing `Module` as its
//    config. A plain `new Function(code)()` makes that `var Module`
//    function-local and hoisted, so `typeof Module` is "undefined" in its
//    own scope, our whole config (canvas/wasm/WAD) is discarded, and it
//    boots into nothing with no error. (b) But a real <script> tag -- the
//    obvious answer to (a), and what this originally did -- runs the glue in
//    TRUE GLOBAL SCOPE, where its many top-level declarations can collide
//    with the host's. That is not hypothetical: in the real CEP panel, some
//    host-injected global already declares `key` lexically, so the glue's
//    own `var key;` threw "Identifier 'key' has already been declared" --
//    a PARSE-time SyntaxError, so not one line of the 276 KB glue ever ran,
//    and it hung on "Loading DOOM..." forever.
//    The fix does both: wrap the source in `(function(Module){ ... })
//    (window.Module)`. A `var Module` that shadows a PARAMETER of the same
//    name reuses the parameter's binding rather than creating a fresh
//    undefined one, so (a) is satisfied -- and every other top-level
//    declaration is now function-scoped, so (b) can't happen for `key` or
//    anything else. `callMain` is function-scoped too, so the wrapper
//    explicitly hands it back out (see DOOM_CALLMAIN_KEY).
//
// 2. WE HAND IT THE BYTES; IT NEVER FETCHES ANYTHING.
//    The panel is loaded from a `file://` URL in the packaged extension,
//    where `fetch()` fails outright, so Emscripten's default asset loading
//    (and the reference `FS.createPreloadedFile()` XHR) can't be used. We
//    read the .wasm/.wad/.cfg ourselves and pass them in: the wasm via
//    `Module.wasmBinary` (which short-circuits all of Emscripten's own
//    locate/fetch logic) and the WAD via `FS.writeFile` in `preRun`. Bytes
//    come from Node's `fs` (the panel runs with `--enable-nodejs`, same
//    escape hatch wrikeApi.ts uses to dodge CORS) and fall back to `fetch`
//    in `yarn dev` browser preview, where there's no Node but there IS a
//    real HTTP server. So this is one of the rare ExtendScript-adjacent
//    features that genuinely IS testable in browser preview.
//
// 3. ESCAPE DOES NOT CLOSE THIS OVERLAY.
//    Escape is DOOM's own menu key. Binding it to "quit the overlay" would
//    make the in-game menu unreachable. Quitting is the X button (or
//    Ctrl/Cmd+Shift+Q), and every key that isn't one of those is
//    deliberately left alone so the game can have it.
//
// LICENSING, flagged deliberately rather than buried: chocolate-doom is
// GPL-2.0, so shipping this inside a signed ZXP handed to artists is a
// conveyance that carries a source-availability obligation, and extracting
// DOOM1.WAD out of the shareware distribution is arguably outside the
// shareware licence's "complete unmodified package" terms. Fine for an
// internal studio gag; if this ever ships to a client, swap `doom1.wad` for
// Freedoom Phase 1 (BSD-ish, drop-in -- chocolate-doom treats it as a valid
// IWAD, no code change needed) and publish the doom-wasm source offer.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { X, Loader2 } from "lucide-react";
import { fs } from "../lib/cep/node";
import { csi } from "../lib/utils/bolt";
import "./DoomEasterEgg.scss";

// AE eats most keystrokes before the panel ever sees them -- which is why the
// canvas received mouse events but no keys at all. The panel's OTHER keyboard
// features (search, Cmd+K) work without any of this because AE already routes
// keys to a focused editable field; a <canvas> gets no such treatment.
//
// CEP's actual answer is `registerKeyEventsInterest`: it tells the host which
// key combinations this extension wants delivered to IT rather than being
// treated as host shortcuts. It must be UNREGISTERED again on unmount (pass
// "[]"), or DOOM would go on stealing these keys from After Effects for the
// rest of the session -- so the cleanup below is load-bearing, not tidiness.
const DOOM_KEYCODES = [
    37, 38, 39, 40,             // arrows: move/turn
    17, 16, 18,                 // ctrl (fire), shift (run), alt (strafe)
    32, 13, 27, 9,              // space (use), enter, escape (menu), tab (map)
    49, 50, 51, 52, 53, 54, 55, // 1-7 weapon select
    87, 65, 83, 68,             // WASD
    188, 190,                   // , . strafe left/right
    89, 78,                     // Y/N for DOOM's own quit prompt
];

/**
 * Every DOOM key, across each ctrl/shift/alt combination -- the modifier flags
 * describe the modifier STATE at press time, and DOOM is routinely played with
 * Ctrl or Shift held down while pressing an arrow, so the bare keycode alone
 * would miss exactly the combinations that matter most.
 *
 * `metaKey` is deliberately never claimed: Cmd-shortcuts stay with After
 * Effects, so Cmd+S still saves while DOOM is open.
 */
const keyEventsInterest = () => {
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < DOOM_KEYCODES.length; i++) {
        for (let c = 0; c < 2; c++) {
            for (let s = 0; s < 2; s++) {
                for (let a = 0; a < 2; a++) {
                    out.push({
                        keyCode: DOOM_KEYCODES[i],
                        ctrlKey: c === 1,
                        shiftKey: s === 1,
                        altKey: a === 1,
                    });
                }
            }
        }
    }
    return JSON.stringify(out);
};

// chocolate-doom's own argv. `-window`/`-nogui` keep it inside our canvas,
// `-nomusic` because the MIDI path in this build is noisy and this is a gag,
// and `-config` points at the bundled keybinding defaults. There is
// deliberately NO `-connect`/`-server`, which is what keeps this build's
// websocket multiplayer code dormant and boots straight to single player.
const DOOM_ARGS = [
    "-iwad", "doom1.wad",
    "-window",
    "-nogui",
    "-nomusic",
    "-config", "default.cfg",
];

// Resolve the sibling `doom/` asset folder from wherever the panel's own
// index.html lives -- `.../main/index.html` (packaged) or `.../main/` (dev
// server) both collapse to `.../doom/`. Never hardcode either form; the
// packaged path is a deep file:// URL that varies per machine.
const assetBaseUrl = () => window.location.href.replace(/\/main\/[^/]*$/, "/doom/");

const nodeAvailable = () => typeof (fs as any)?.readFileSync === "function";

/**
 * Read one asset as bytes.
 *
 * Dispatch is on the URL SCHEME, deliberately NOT on whether Node exists.
 * The panel is a `file://` page once installed, but `yarn dev` HMR mode
 * serves it from `http://localhost:3000` -- and Node is available in BOTH,
 * because it's the same AE panel either way. Gating on Node instead sent the
 * dev-mode http URL straight into `fs.readFileSync`, which failed with a
 * baffling `ENOENT ... open 'http://localhost:3000/doom/...'`. Scheme is the
 * only thing that actually distinguishes the two cases.
 */
const readAsset = async (name: string): Promise<Uint8Array> => {
    const base = assetBaseUrl();

    if (base.indexOf("file://") === 0) {
        if (!nodeAvailable()) {
            throw new Error("Node isn't available to read the DOOM assets from disk.");
        }
        // file:// URL -> real filesystem path. decodeURIComponent matters:
        // a real install path can contain spaces ("Application Support").
        const dir = decodeURIComponent(base.slice("file://".length));
        return new Uint8Array(fs.readFileSync(dir + name));
    }

    // http(s): dev server, or any future non-file host. A normal origin, so
    // fetch is fine here -- it's only the file:// case that forces Node.
    const res = await fetch(base + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
};

/** Read one asset as text (the glue source). Same scheme rule as readAsset. */
const readAssetText = async (name: string): Promise<string> => {
    const base = assetBaseUrl();
    if (base.indexOf("file://") === 0) {
        if (!nodeAvailable()) {
            throw new Error("Node isn't available to read the DOOM engine from disk.");
        }
        const dir = decodeURIComponent(base.slice("file://".length));
        return fs.readFileSync(dir + name, "utf8") as unknown as string;
    }
    const res = await fetch(base + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res.text();
};

// Where the wrapper hands `callMain` back out of its closure. A window
// property rather than a global declaration, so it can't collide the way the
// glue's own top-level names did.
const DOOM_CALLMAIN_KEY = "__xyiDoomCallMain";

// ONE BOOT PER PAGE SESSION, deliberately.
//
// Emscripten has no API to destroy a runtime, so executing the glue twice in
// one page leaves two runtimes fighting over the same `#canvas`, the same
// audio context and the same exported globals -- which HARD-CRASHES the CEF
// renderer process (observed directly: AE's panel died and respawned). This
// is not a theoretical path: this panel is known to mount React twice on
// cold start (the reason GsapScreenTransition carries its own dedupe), and
// any remount would otherwise re-run the effect below. A module-scope flag
// survives remounts within the page, so it's the right scope for this --
// component state or a ref would both reset exactly when we need them not to.
let bootedThisSession = false;

type Phase = "loading" | "running" | "error";

export const DoomEasterEgg = ({ onClose }: { onClose: () => void }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // The keyboard trap -- see keepKeyGrabFocused below.
    const keyGrabRef = useRef<HTMLInputElement>(null);
    const [phase, setPhase] = useState<Phase>("loading");
    const [error, setError] = useState("");

    // Claim the keyboard from AE for as long as DOOM is on screen, and hand
    // it straight back on unmount. Separate effect from the launch effect so
    // the release still happens even if the engine failed to boot.
    useEffect(() => {
        try {
            csi.registerKeyEventsInterest(keyEventsInterest());
        } catch {
            /* no CEP host (browser preview) -- keys arrive normally there */
        }
        return () => {
            try {
                csi.registerKeyEventsInterest("[]");
            } catch {
                /* nothing to release if there was no host to claim from */
            }
        };
    }, []);

    // THE THING THAT ACTUALLY MAKES THE KEYBOARD WORK.
    //
    // `registerKeyEventsInterest` above is the documented CEP answer, but on
    // macOS AE it had no effect -- arrows still drove AE's own panel
    // navigation and DOOM saw nothing. What demonstrably DOES get keys into
    // this panel is a focused EDITABLE FIELD: that's the only reason the home
    // search box and Cmd+K work at all. AE forwards keystrokes to the web
    // view when a text input holds focus, and swallows them as host shortcuts
    // when anything else does.
    //
    // So we keep a deliberately invisible <input> focused for as long as DOOM
    // is open. Its keydown events BUBBLE UP TO `document`, which is exactly
    // where SDL registered its handlers (`specialHTMLTargets[1]` in the glue)
    // -- so no manual event re-dispatching is needed, the bubble does it.
    //
    // It must be genuinely focusable: `display:none`/`visibility:hidden`
    // cannot hold focus, which is why it's opacity-0 and 1px instead.
    const keepKeyGrabFocused = useCallback(() => {
        const el = keyGrabRef.current;
        if (el && document.activeElement !== el) el.focus();
    }, []);

    useEffect(() => {
        keepKeyGrabFocused();
        // AE can move focus out from under us (clicking the comp, panel
        // switches). Re-assert it on a slow interval rather than fighting
        // every blur, so it can't get into a focus tug-of-war with a real
        // click on the close button.
        const id = setInterval(keepKeyGrabFocused, 400);
        return () => clearInterval(id);
    }, [keepKeyGrabFocused]);

    // Quit shortcut. Deliberately NOT Escape (DOOM's menu key) -- see the
    // header note. Shift is in there so a stray Ctrl+Q can't bin a session.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === "q" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;

        if (bootedThisSession) {
            setError("DOOM has already run in this session.");
            setPhase("error");
            return;
        }

        (async () => {
            try {
                const [wasmBinary, wad, cfg, glueSource] = await Promise.all([
                    readAsset("websockets-doom.wasm"),
                    readAsset("doom1.wad"),
                    readAsset("default.cfg"),
                    readAssetText("websockets-doom.js"),
                ]);
                if (cancelled) return;

                const canvas = canvasRef.current;
                if (!canvas) throw new Error("canvas went away before launch");

                // The glue reads this global on startup (see note 1 above).
                (window as any).Module = {
                    canvas,
                    wasmBinary,
                    noInitialRun: true,
                    // Write the WAD straight into Emscripten's in-memory FS.
                    // `preRun` is the only hook that runs late enough for FS
                    // to exist but early enough to beat DOOM's own file open.
                    preRun: [
                        function (this: any) {
                            const M = (window as any).Module;
                            M.FS.writeFile("doom1.wad", wad);
                            M.FS.writeFile("default.cfg", cfg);
                        },
                    ],
                    onRuntimeInitialized: () => {
                        const M = (window as any).Module;
                        // callMain is function-scoped inside the wrapper now,
                        // so take the handle the wrapper exported (preferring
                        // Module's own, if this build happens to export it).
                        const main = M.callMain || (window as any)[DOOM_CALLMAIN_KEY];
                        if (typeof main !== "function") {
                            throw new Error("DOOM engine loaded but callMain was never exported.");
                        }
                        main(DOOM_ARGS);
                        if (!cancelled) setPhase("running");
                        canvas.focus();
                    },
                    print: (t: string) => console.log("[doom]", t),
                    printErr: (t: string) => console.warn("[doom]", t),
                };

                // See note 1 in the header for why this exact shape. The
                // trailing line is how `callMain` escapes the closure.
                const wrapped =
                    "(function(Module){\n" +
                    glueSource +
                    "\n;window[" + JSON.stringify(DOOM_CALLMAIN_KEY) + "] =" +
                    " typeof callMain === 'function' ? callMain : null;\n" +
                    "})(window.Module);";

                // Set BEFORE executing, not after: if the glue throws, we
                // still must never attempt a second runtime in this page.
                bootedThisSession = true;
                // eslint-disable-next-line no-new-func
                new Function(wrapped)();
            } catch (e: any) {
                if (cancelled) return;
                setError(e?.message || String(e));
                setPhase("error");
            }
        })();

        return () => {
            cancelled = true;
            // Best-effort teardown: stop the main loop and drop the globals
            // so the page isn't left holding a live runtime. This does NOT
            // make the runtime relaunchable -- Emscripten has no destroy API,
            // and a second boot crashes the renderer, which is exactly what
            // `bootedThisSession` above exists to prevent. Reloading the
            // panel is the only real reset.
            try {
                (window as any).Module?.pauseMainLoop?.();
            } catch {
                /* nothing useful to do if the runtime is already gone */
            }
            try {
                delete (window as any).Module;
                delete (window as any)[DOOM_CALLMAIN_KEY];
            } catch {
                (window as any).Module = undefined;
                (window as any)[DOOM_CALLMAIN_KEY] = undefined;
            }
        };
    }, []);

    return (
        <motion.div
            className="doom-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
        >
            <div className="doom-frame">
                <div className="doom-bar">
                    <span className="doom-title">DOOM</span>
                    <span className="doom-hint">
                        Arrows move &middot; Ctrl fires &middot; Space opens &middot; Esc is DOOM&rsquo;s own
                        menu &middot; click the game if keys stop responding
                    </span>
                    <button className="doom-close" onClick={onClose} title="Quit (Ctrl/Cmd+Shift+Q)">
                        <X size={16} />
                    </button>
                </div>

                {/* The canvas is always mounted -- Emscripten binds to it
                    before the runtime is ready, so it can't be conditional. */}
                <div className="doom-stage" onMouseDown={keepKeyGrabFocused}>
                    {/* Keyboard trap. preventDefault stops the caret/text
                        nonsense but does NOT stop propagation, so the event
                        still bubbles to document where SDL is listening. */}
                    <input
                        ref={keyGrabRef}
                        className="doom-keygrab"
                        aria-hidden="true"
                        autoComplete="off"
                        onKeyDown={(e) => e.preventDefault()}
                        onChange={() => undefined}
                        value=""
                    />
                    <canvas
                        ref={canvasRef}
                        id="canvas"
                        className="doom-canvas"
                        tabIndex={-1}
                        onContextMenu={(e) => e.preventDefault()}
                    />
                    {phase !== "running" && (
                        <div className="doom-status">
                            {phase === "loading" ? (
                                <>
                                    <Loader2 className="spin" size={20} />
                                    <span>Loading DOOM&hellip;</span>
                                </>
                            ) : (
                                <>
                                    <span className="doom-error">{error}</span>
                                    <span className="doom-error-sub">
                                        {bootedThisSession
                                            ? "Reload the panel to play again."
                                            : "Check that doom/ shipped alongside main/."}
                                    </span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export default DoomEasterEgg;
