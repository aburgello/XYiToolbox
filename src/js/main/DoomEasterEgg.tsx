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
// ============================================================================
// THE ENGINE RUNS IN AN IFRAME. THAT IS THE WHOLE DESIGN. DO NOT "SIMPLIFY".
// ============================================================================
// The first version ran the engine directly in the panel's own page, and it
// worked -- but it permanently contaminated the panel, because EMSCRIPTEN HAS
// NO API TO DESTROY A RUNTIME. Two concrete symptoms, both reported from real
// use, both traced to that one root cause:
//
//   1. AFTER QUITTING DOOM, THE PANEL WAS HARD TO USE. SDL registers 4
//      keyboard + 6 mouse handlers on `document` (Emscripten's JSEvents) and
//      calls preventDefault() liberally. Unmounting the overlay removed the
//      canvas and deleted `window.Module`, but those handlers are closures
//      inside the engine's own scope -- nothing detached them, so SDL went on
//      swallowing arrows / Ctrl / Space / Tab / Esc / 1-7 / WASD panel-wide
//      for the rest of the session.
//   2. IT COULD ONLY BE LAUNCHED ONCE PER PANEL SESSION. A second runtime in
//      the same page fights the first over the canvas, the audio context and
//      the exported globals, and HARD-CRASHES the CEF renderer (observed: AE's
//      panel died and respawned). So a module-scope flag had to refuse every
//      launch after the first.
//
// An iframe fixes both at the root rather than patching symptoms: the engine
// gets its OWN realm -- its own `document`, globals, audio context and wasm
// heap. Removing the iframe destroys all of it outright, which is the teardown
// Emscripten refuses to give us. Hence: no leaked listeners, and DOOM is
// freely replayable.
//
// It also DELETED two nasty workarounds the in-page version needed, so if you
// are tempted to move this back into the panel's page, know what returns:
//   - No `new Function("(function(Module){...})(window.Module)")` wrapper. The
//     glue opens with `var Module = typeof Module !== "undefined" ? Module : {}`
//     -- a plain <script> tag in a scope where `window.Module` is already set
//     adopts it correctly (a `var` on an existing global keeps its value).
//     That's only safe here because the iframe's global scope is EMPTY.
//   - No `key` collision. In the panel's page some host-injected global already
//     declared `key` lexically, so the glue's own top-level `var key;` threw
//     "Identifier 'key' has already been declared" -- a PARSE-time error, so
//     not one line of the 276 KB glue ran and it hung on "Loading DOOM..."
//     forever. A fresh iframe realm has no such globals.
//
// TWO THINGS THAT ARE STILL TRUE AND STILL LOAD-BEARING:
//
// A. WE HAND IT THE BYTES; IT NEVER FETCHES ANYTHING.
//    The panel is loaded from a `file://` URL in the packaged extension, where
//    `fetch()` fails outright, so Emscripten's default asset loading can't be
//    used. The PARENT reads the .wasm/.wad/.cfg (Node's `fs`, via the panel's
//    `--enable-nodejs`; `fetch` in `yarn dev` preview) and passes them in:
//    the wasm via `Module.wasmBinary` (short-circuits all of Emscripten's own
//    locate/fetch logic) and the WAD via `FS.writeFile` in `preRun`. The
//    iframe never loads a URL of its own, which also means it doesn't matter
//    that an about:blank iframe has no useful base URL.
//
// B. ESCAPE DOES NOT CLOSE THIS OVERLAY.
//    Escape is DOOM's own menu key. Binding it to "quit" would make the
//    in-game menu unreachable. Quitting is the X button (or Ctrl/Cmd+Shift+Q),
//    and every other key is deliberately left to the game.
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
 * `file://` URL -> a real filesystem path Node can actually open.
 *
 * Two separate corrections, both load-bearing:
 *
 * 1. `decodeURIComponent` -- a real install path contains percent-escapes for
 *    spaces (macOS "Application Support").
 * 2. THE LEADING SLASH IS THE WINDOWS CASE, and it is not optional. A Windows
 *    file URL is `file:///C:/Users/...`, so slicing off `file://` leaves
 *    `/C:/Users/...` -- which fs rejects with a confusing
 *    `ENOENT: no such file or directory, open '/C:/Users/...'` even though the
 *    file is plainly there (observed on a real Windows install). macOS URLs
 *    are `file:///Users/...` -> `/Users/...`, already correct, so the strip is
 *    gated on a drive letter and leaves POSIX paths untouched.
 *
 * The studio runs macOS, which is why this went unnoticed until the panel was
 * opened on Windows. Any future Node-fs-from-a-file-URL code in this panel
 * needs this same conversion -- don't hand `location.href.slice(7)` to fs.
 */
const fileUrlToPath = (url: string): string => {
    const decoded = decodeURIComponent(url.slice("file://".length));
    return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
};

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
        return new Uint8Array(fs.readFileSync(fileUrlToPath(base) + name));
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
        return fs.readFileSync(fileUrlToPath(base) + name, "utf8") as unknown as string;
    }
    const res = await fetch(base + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res.text();
};

// The iframe's whole document. Written in one go rather than loaded from a
// URL -- an about:blank iframe inherits the parent's origin, so the parent can
// reach into it, and nothing here needs a real base URL (see note A: the
// engine is handed its bytes and never fetches).
//
// The <input> is the keyboard trap, and it lives INSIDE the iframe on purpose:
// SDL binds its key handlers to THIS document, so the keystrokes have to
// arrive (and bubble) here, not in the parent. It must be genuinely focusable
// -- display:none / visibility:hidden cannot hold focus -- hence opacity 0 at
// 1px rather than hidden.
const IFRAME_DOC = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>DOOM</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
  /* DOOM renders at 320x200. Nearest-neighbour keeps it crisp and correctly
     chunky instead of a blurry upscale. */
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; outline: none; }
  input { position: absolute; top: 0; left: 0; width: 1px; height: 1px;
          padding: 0; border: 0; opacity: 0; pointer-events: none; }
</style>
</head>
<body>
  <input id="keygrab" aria-hidden="true" autocomplete="off">
  <canvas id="canvas" tabindex="-1"></canvas>
</body>
</html>`;

type Phase = "loading" | "running" | "error";

export const DoomEasterEgg = ({ onClose }: { onClose: () => void }) => {
    const frameRef = useRef<HTMLIFrameElement>(null);
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
    // macOS AE it had no effect on its own -- arrows still drove AE's own panel
    // navigation and DOOM saw nothing. What demonstrably DOES get keys into
    // this panel is a focused EDITABLE FIELD: that's the only reason the home
    // search box and Cmd+K work at all. AE forwards keystrokes to the web view
    // when a text input holds focus, and swallows them as host shortcuts when
    // anything else does.
    //
    // So we keep the iframe's invisible <input> focused for as long as DOOM is
    // open. Its keydown events bubble up to the IFRAME's document, which is
    // exactly where SDL registered its handlers -- so no manual event
    // re-dispatching is needed, the bubble does it.
    const focusKeyGrab = useCallback(() => {
        const win = frameRef.current?.contentWindow as any;
        const doc = win?.document;
        if (!doc) return;
        const el = doc.getElementById("keygrab");
        if (el && doc.activeElement !== el) el.focus();
    }, []);

    useEffect(() => {
        focusKeyGrab();
        // AE can move focus out from under us (clicking the comp, panel
        // switches). Re-assert it on a slow interval rather than fighting
        // every blur, so it can't get into a focus tug-of-war with a real
        // click on the close button.
        const id = setInterval(focusKeyGrab, 400);
        return () => clearInterval(id);
    }, [focusKeyGrab]);

    // Quit shortcut. Deliberately NOT Escape (DOOM's menu key) -- see note B.
    // Shift is in there so a stray Ctrl+Q can't bin a session. Bound to BOTH
    // documents: once DOOM is running the keystrokes land inside the iframe,
    // so a parent-only listener would never see them.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === "q" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        const innerDoc = frameRef.current?.contentWindow?.document;
        innerDoc?.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            innerDoc?.removeEventListener("keydown", onKeyDown);
        };
    }, [onClose, phase]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const [wasmBinary, wad, cfg, glueSource] = await Promise.all([
                    readAsset("websockets-doom.wasm"),
                    readAsset("doom1.wad"),
                    readAsset("default.cfg"),
                    readAssetText("websockets-doom.js"),
                ]);
                if (cancelled) return;

                const frame = frameRef.current;
                const win = frame?.contentWindow as any;
                if (!frame || !win) throw new Error("iframe went away before launch");

                // Write the engine's document. open/write/close rather than
                // srcdoc: srcdoc would mean waiting on a load event, and this
                // is synchronous and immediately reachable.
                const doc: Document = win.document;
                doc.open();
                doc.write(IFRAME_DOC);
                doc.close();

                const canvas = doc.getElementById("canvas") as HTMLCanvasElement | null;
                if (!canvas) throw new Error("iframe canvas missing");

                // Re-create the byte arrays INSIDE the iframe's realm. Typed
                // arrays are realm-tagged; handing the engine a parent-realm
                // Uint8Array works in most paths but not reliably in all of
                // them, and a wrong guess here fails deep inside the wasm
                // loader with an opaque error. Copying is cheap next to
                // instantiating a 2 MB module.
                const intoRealm = (bytes: Uint8Array) => {
                    const out = new win.Uint8Array(bytes.length);
                    out.set(bytes);
                    return out;
                };

                // The glue reads this global on startup. Set BEFORE the script
                // is injected -- see the header for why a plain <script> is
                // correct here and a wrapper is not.
                win.Module = {
                    canvas,
                    wasmBinary: intoRealm(wasmBinary),
                    noInitialRun: true,
                    // Write the WAD straight into Emscripten's in-memory FS.
                    // `preRun` is the only hook that runs late enough for FS
                    // to exist but early enough to beat DOOM's own file open.
                    preRun: [
                        function () {
                            const M = win.Module;
                            M.FS.writeFile("doom1.wad", intoRealm(wad));
                            M.FS.writeFile("default.cfg", intoRealm(cfg));
                        },
                    ],
                    onRuntimeInitialized: () => {
                        // `function callMain` is a top-level declaration in the
                        // glue, so in the iframe's own global scope it lands
                        // on the iframe window. (It is NOT exported on Module
                        // by this build -- don't "tidy" this to M.callMain.)
                        const main = win.callMain || win.Module?.callMain;
                        if (typeof main !== "function") {
                            if (!cancelled) {
                                setError("DOOM engine loaded but callMain was never exported.");
                                setPhase("error");
                            }
                            return;
                        }
                        main(DOOM_ARGS);
                        if (!cancelled) setPhase("running");
                        focusKeyGrab();
                    },
                    print: (t: string) => console.log("[doom]", t),
                    printErr: (t: string) => console.warn("[doom]", t),
                };

                const script = doc.createElement("script");
                script.textContent = glueSource;
                doc.body.appendChild(script);
            } catch (e: any) {
                if (cancelled) return;
                setError(e?.message || String(e));
                setPhase("error");
            }
        })();

        return () => {
            cancelled = true;
            // No manual teardown needed, and that is the entire point of the
            // iframe: React removes it on unmount, which destroys the realm --
            // runtime, SDL's document listeners, audio context and wasm heap
            // all go with it. Blanking the src first just makes the teardown
            // immediate rather than waiting on GC.
            try {
                const frame = frameRef.current;
                (frame?.contentWindow as any)?.Module?.pauseMainLoop?.();
                if (frame) frame.src = "about:blank";
            } catch {
                /* realm may already be gone -- nothing useful to do */
            }
        };
    }, [focusKeyGrab]);

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

                {/* 320x200 is DOOM's aspect (62.5%), held with the padding-box
                    trick -- CSS aspect-ratio is Chrome 88+ and this project
                    targets chrome74 (see CLAUDE.md's build-target rule). */}
                <div className="doom-stage" onMouseDown={focusKeyGrab}>
                    {/* Always mounted: the engine binds to the iframe's canvas
                        before the runtime is ready, so it can't be conditional. */}
                    <iframe
                        ref={frameRef}
                        className="doom-iframe"
                        title="DOOM"
                        // No src: an about:blank iframe inherits the parent's
                        // origin, which is what lets us write into it.
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
                                        Check that <code>doom/</code> shipped alongside <code>main/</code>.
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
