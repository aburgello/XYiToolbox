// =============================================================================
// src/js/main/AgentBubble.tsx
// -----------------------------------------------------------------------------
// Ask, as a floating panel available on every screen.
//
// WHY THIS IS NOT A TOOL PAGE ANY MORE.
// Ask can navigate ("opened Big Guy Localiser for you"). As a tool page that
// was self-defeating: navigating unmounted the tool, which threw away the
// conversation that asked for it. You landed on the right screen with no way
// to ask a follow-up and no record of what you had just been told.
//
// Mounted in main.tsx's shell next to DialogHost, so it outlives every screen
// change and the transcript survives navigation.
//
// COLLAPSED WITH CSS, NOT UNMOUNTED -- deliberately. Unmounting on close would
// lose the transcript the same way navigating used to, and "I closed it for a
// second" should not be destructive. It is lazily mounted on first open, so an
// artist who never uses it never pays for it.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import AskIcon from "./AskIcon";
import AgentChat from "./tools/AgentChat";
import { isAgentEnabled, isBubbleOpen, setBubbleOpen, subscribeToBubble } from "./lib/agent/bubbleControl";
import "./AgentBubble.scss";

const SIZE_KEY = "xyi.agent.panelSize";
const DEFAULT_W = 380;
const DEFAULT_H = 520;
// Below this the transcript stops being readable and the input has nowhere to
// go; the panel would still "work" and be useless.
const MIN_W = 300;
const MIN_H = 260;

/**
 * Held inside the window, with room for the margins the panel is pinned by.
 *
 * Clamped in JS rather than left to the stylesheet's max-width/max-height: a
 * CSS cap would stop the box growing but not the drag, so the corner would
 * detach from the cursor and keep travelling. The stylesheet's caps stay as a
 * backstop for the default size.
 */
function clampSize(w: number, h: number): { w: number; h: number } {
    const maxW = Math.max(MIN_W, window.innerWidth - 36);
    const maxH = Math.max(MIN_H, window.innerHeight - 90);
    return {
        w: Math.round(Math.min(Math.max(w, MIN_W), maxW)),
        h: Math.round(Math.min(Math.max(h, MIN_H), maxH)),
    };
}

const AgentBubble: React.FC = () => {
    // OPEN AND ENABLED BOTH LIVE OUTSIDE THIS COMPONENT, in bubbleControl.
    // Enabled is an opt-in the home screen owns; open is changed from three
    // places (the launcher, this panel's X, and enabling it). Mirroring the
    // shared state into React state here is what makes all three agree.
    const [enabled, setEnabled] = useState(isAgentEnabled);
    const [open, setOpenState] = useState(isBubbleOpen);
    useEffect(() => subscribeToBubble(() => {
        setEnabled(isAgentEnabled());
        setOpenState(isBubbleOpen());
    }), []);
    const setOpen = (v: boolean) => setBubbleOpen(v);
    // Stays true once opened: see the header note on why this never unmounts.
    const [mounted, setMounted] = useState(false);
    // Bumped on every open so the ask box takes focus. A mount effect cannot
    // do this job -- the panel is hidden with CSS rather than unmounted, so it
    // only ever mounts once.
    const [focusKey, setFocusKey] = useState(0);

    // --- size ---------------------------------------------------------------
    // Kept in localStorage, matching provider.ts's deliberate choice to keep
    // this whole experiment out of src/jsx. A panel size is a per-machine
    // preference anyway; it has no business travelling with a team profile.
    const [size, setSize] = useState<{ w: number; h: number }>(() => {
        try {
            const raw = window.localStorage.getItem(SIZE_KEY);
            if (raw) {
                const v = JSON.parse(raw);
                if (v && typeof v.w === "number" && typeof v.h === "number") return clampSize(v.w, v.h);
            }
        } catch { /* private mode, or nothing saved -- the default is fine */ }
        return { w: DEFAULT_W, h: DEFAULT_H };
    });

    // Mouse events, not pointer events: the macOS AE CEP host does not dispatch
    // Pointer Events reliably, which is this codebase's standing rule for
    // anything beyond a plain click.
    const dragRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

    const startResize = (e: React.MouseEvent) => {
        dragRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
        e.preventDefault();
    };

    useEffect(() => {
        const move = (e: MouseEvent) => {
            const d = dragRef.current;
            if (!d) return;
            // THE PANEL IS PINNED BOTTOM-RIGHT, so it grows up and to the LEFT:
            // dragging the handle left (negative dx) has to make it WIDER, not
            // narrower. Getting this backwards is the classic version of this
            // bug, and it feels like the panel fighting the cursor.
            setSize(clampSize(d.w - (e.clientX - d.x), d.h - (e.clientY - d.y)));
        };
        const up = () => {
            if (!dragRef.current) return;
            dragRef.current = null;
            // Saved on RELEASE, not on every move: a drag fires mousemove
            // dozens of times a second and localStorage writes are synchronous.
            setSize((s) => {
                try { window.localStorage.setItem(SIZE_KEY, JSON.stringify(s)); } catch { /* session only */ }
                return s;
            });
        };
        // NOT WHILE THE AGENT IS OFF. These drive a resize handle that does not
        // exist then, and a global mousemove listener on a panel somebody has
        // switched off is the sort of thing "opt-in" is supposed to mean the
        // absence of. The handler early-returns without a drag in progress, so
        // the cost was small -- but small is not the claim being made.
        if (!enabled) return;
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, [enabled]);

    // A window that shrinks below a stored size would otherwise leave the panel
    // hanging off the edge, and the handle with it.
    useEffect(() => {
        if (!enabled) return;
        const onResize = () => setSize((s) => clampSize(s.w, s.h));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [enabled]);
    // The header node AgentChat renders its status controls into. See the slot
    // in the markup below for why this is state and not a ref.
    const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);

    const toggle = () => {
        if (!mounted) setMounted(true);
        if (!open) setFocusKey((k) => k + 1);
        setOpen(!open);
    };

    // Enabling from the home screen opens it, and that arrives through the
    // subscription rather than through `toggle` -- so the focus bump has to
    // happen here too, or the ask box would not take the caret on the one
    // route most likely to be somebody's first ever use of it.
    useEffect(() => {
        if (!open) return;
        if (!mounted) setMounted(true);
        setFocusKey((k) => k + 1);
    }, [open]);

    // NOTHING AT ALL WHEN IT IS OFF -- no panel, no launcher, no keygrab.
    // "Opt in" has to mean the screen is unchanged for somebody who never
    // wanted it, otherwise it is just a collapsed version of the same thing.
    if (!enabled) return null;

    return (
        <>
            {mounted && (
                <div
                    className={"agent-bubble-panel" + (open ? " is-open" : "")}
                    aria-hidden={!open}
                    style={{ width: size.w, height: size.h }}
                >
                    {/* TOP-LEFT, because the panel is pinned bottom-right and
                        that is the only corner with anywhere to go. A handle on
                        the bottom-right would be dragging against the two edges
                        the panel is anchored to. */}
                    <span
                        className="agent-bubble-resize"
                        onMouseDown={startResize}
                        title="Drag to resize"
                        aria-hidden="true"
                    />
                    <div className="agent-bubble-head">
                        <span className="agent-bubble-title"><AskIcon size={14} /> Ask</span>
                        {/* AgentChat portals its key button and running cost in
                            here. A callback ref rather than useRef, because a
                            ref object does not re-render on attach and the
                            portal would have nothing to target on first paint
                            -- the controls would only appear after some other
                            state change happened to re-render the panel. */}
                        <span className="agent-bubble-head-slot" ref={setHeadSlot} />
                        <button
                            className="agent-bubble-close"
                            onClick={() => setOpen(false)}
                            title="Hide — your conversation is kept"
                            aria-label="Hide Ask"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <div className="agent-bubble-body">
                        <AgentChat focusKey={focusKey} headerSlot={headSlot} />
                    </div>
                </div>
            )}

            {/* HIDDEN WHILE OPEN. The panel carries its own close button in
                its header; leaving the launcher up as a second X put two
                close affordances a few pixels apart, one of them half behind
                the panel. */}
            {!open && (
                <button
                    className="agent-bubble-fab"
                    onClick={toggle}
                    title="Ask about campaigns, masters and tools"
                    aria-label="Ask"
                >
                    <AskIcon size={18} />
                </button>
            )}
        </>
    );
};

export default AgentBubble;
