// Shared shell for the panel's little built-in games (the "arcade" eggs).
//
// WHY THIS EXISTS: every game hits one genuinely hard problem that has nothing
// to do with the game itself -- **After Effects eats keystrokes before a CEP
// panel ever sees them**. That solution lives here rather than being
// copy-pasted per game.
//
// WHAT THIS IS *NOT*: an iframe. These are games we wrote ourselves -- plain
// JS whose listeners and timers we own and remove on unmount -- so they render
// straight into this overlay. An iframe would buy isolation nothing here needs
// and cost a realm boundary. (A wasm-emulator game WOULD need one, since
// Emscripten has no destroy-the-runtime API and permanently contaminates its
// page; there isn't one in the arcade any more.)
//
// THE KEYBOARD, which is the whole point of this file:
//   1. `registerKeyEventsInterest` is CEP's documented way to tell the host
//      "deliver these combos to the extension, don't treat them as host
//      shortcuts". It MUST be released with "[]" on unmount or the game keeps
//      stealing those keys from AE for the rest of the session.
//   2. ...but on macOS AE that alone demonstrably did NOT work. What actually
//      delivers keys is a FOCUSED EDITABLE FIELD -- the only reason the home
//      search box and Cmd+K work at all. So a deliberately invisible <input>
//      is kept focused for as long as the overlay is open, and keydown events
//      bubble from it up to `document`, where the game listens.
//      That input must stay genuinely focusable: display:none/visibility:hidden
//      cannot hold focus, hence opacity-0 at 1px. `pointer-events:none` so it
//      can never swallow a click meant for the close button.
//   3. Focus is re-asserted on a slow interval rather than on every blur, so
//      it can't get into a tug-of-war with a real click on the X.
//
// ESCAPE CLOSES THESE GAMES. Worth stating because it isn't universal: a game
// that used Escape as its own in-game menu key would need a different quit
// binding. None of ours do, so Escape is the obvious thing and it works.
import { useCallback, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { csi } from "../../lib/utils/bolt";
import "./ArcadeFrame.scss";

/**
 * Build the CEP key-interest payload: every requested keycode across each
 * ctrl/shift/alt combination, because the modifier flags describe the modifier
 * STATE at press time -- a bare keycode would miss a key pressed while Shift
 * happens to be held.
 *
 * `metaKey` is deliberately never claimed, so Cmd-shortcuts stay with After
 * Effects and Cmd+S still saves while a game is open.
 */
const keyEventsInterest = (keyCodes: number[]) => {
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < keyCodes.length; i++) {
        for (let c = 0; c < 2; c++) {
            for (let s = 0; s < 2; s++) {
                for (let a = 0; a < 2; a++) {
                    out.push({ keyCode: keyCodes[i], ctrlKey: c === 1, shiftKey: s === 1, altKey: a === 1 });
                }
            }
        }
    }
    return JSON.stringify(out);
};

interface Props {
    title: string;
    hint?: string;
    /** Keycodes this game wants delivered to the panel rather than to AE. */
    keyCodes: number[];
    /**
     * Canvas games get a fixed 8:5 stage (the padding-box aspect trick);
     * DOM-laid-out games (the word puzzle) want to size to their own content
     * instead. Default stays the aspect box so existing games are unaffected.
     */
    fluid?: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

export const ArcadeFrame = ({ title, hint, keyCodes, fluid, onClose, children }: Props) => {
    const keyGrabRef = useRef<HTMLInputElement>(null);

    // Claim the keyboard from AE for as long as the game is on screen, and
    // hand it straight back on unmount. Its own effect so the release still
    // happens even if the game itself throws while mounting.
    useEffect(() => {
        try {
            csi.registerKeyEventsInterest(keyEventsInterest(keyCodes));
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
        // keyCodes is a module-level constant per game; re-registering on every
        // render would thrash the host for no reason.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * The keygrab exists only to guarantee that SOME editable field holds
     * focus, because that's the condition under which AE forwards keystrokes
     * to the panel at all. So if the GAME has its own focused text field, that
     * condition is already met and there is nothing to do.
     *
     * This is not a nicety -- without the check, the 400ms re-focus interval
     * yanks the caret out of a game's own <input> a few times a second, which
     * is exactly what made CHAIN's film search impossible to type into ("the
     * text cursor gets swallowed quickly and I can't type"). Any future game
     * with a text field would hit the identical bug.
     */
    const isEditable = (el: Element | null): boolean => {
        if (!el) return false;
        const tag = el.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable === true;
    };

    const focusKeyGrab = useCallback(() => {
        const el = keyGrabRef.current;
        if (!el) return;
        const active = document.activeElement;
        if (active === el) return;
        if (isEditable(active)) return; // a real field already has it -- leave it alone
        el.focus();
    }, []);

    // Clicking the stage re-asserts the grab, but NOT when the click is landing
    // on a real field: mousedown fires before focus moves, so grabbing here
    // would fight the click that's about to focus that input.
    const onStageMouseDown = useCallback((e: React.MouseEvent) => {
        if (isEditable(e.target as Element)) return;
        focusKeyGrab();
    }, [focusKeyGrab]);

    useEffect(() => {
        focusKeyGrab();
        const id = setInterval(focusKeyGrab, 400);
        return () => clearInterval(id);
    }, [focusKeyGrab]);

    // Escape, or Ctrl/Cmd+Shift+Q as a second, chord-style quit.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const q = e.key.toLowerCase() === "q" && e.shiftKey && (e.metaKey || e.ctrlKey);
            if (e.key === "Escape" || q) {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return (
        <motion.div
            className="arcade-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
        >
            <div className="arcade-frame">
                <div className="arcade-bar">
                    <span className="arcade-title">{title}</span>
                    {hint && <span className="arcade-hint">{hint}</span>}
                    <button className="arcade-close" onClick={onClose} title="Quit (Esc)">
                        <X size={16} />
                    </button>
                </div>
                <div className={fluid ? "arcade-stage arcade-stage--fluid" : "arcade-stage"} onMouseDown={onStageMouseDown}>
                    {/* Keyboard trap -- see the header. preventDefault stops the
                        caret/text nonsense but does NOT stop propagation, so the
                        event still bubbles to document where the game listens. */}
                    <input
                        ref={keyGrabRef}
                        className="arcade-keygrab"
                        aria-hidden="true"
                        autoComplete="off"
                        onKeyDown={(e) => e.preventDefault()}
                        onChange={() => undefined}
                        value=""
                    />
                    {children}
                </div>
            </div>
        </motion.div>
    );
};

export default ArcadeFrame;
