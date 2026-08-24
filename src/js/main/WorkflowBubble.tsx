// =============================================================================
// src/js/main/WorkflowBubble.tsx
// -----------------------------------------------------------------------------
// The creative's checklist, as a floating panel available on every screen.
//
// WHY THIS IS NOT A TOOL PAGE.
// A workflow step's whole job is to send you somewhere — "swap the OV artwork"
// links to OV Swap. As a tool page that is self-defeating: following the link
// unmounts the checklist, so you arrive at the right screen having lost the
// list of what to do next. You then have to navigate back to find out. The
// panel outlives navigation, so the list is still there when you land.
//
// This is the shell the Ask agent used to live in, and it is the one part of
// that feature worth keeping — a panel that survives screen changes, sized and
// remembered per machine. What sat inside it was the problem, not the frame.
//
// COLLAPSED WITH CSS, NOT UNMOUNTED. Unmounting on close would throw away the
// board read and the scroll position, and re-read the team folder every time
// somebody put it away for a second. It is lazily mounted on first open, so a
// machine that never opens it never pays for the read.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { X, Route } from "lucide-react";
import WorkflowBoard from "./tools/WorkflowBoard";
import { navigateToTool } from "./lib/navigation";
import { isWorkflowBubbleEnabled, isBubbleOpen, setBubbleOpen, subscribeToBubble } from "./lib/workflowBubble";
import "./WorkflowBubble.scss";

const SIZE_KEY = "xyi.workflows.panelSize";
const DEFAULT_W = 380;
const DEFAULT_H = 540;
// Below this a step's text wraps to three lines and its link chip drops off the
// row; the panel would still "work" and be unreadable.
const MIN_W = 300;
const MIN_H = 280;

/**
 * Held inside the window, with room for the margins the panel is pinned by.
 *
 * Clamped in JS rather than left to the stylesheet's max-width/max-height: a
 * CSS cap would stop the box growing but not the drag, so the corner would
 * detach from the cursor and keep travelling.
 */
function clampSize(w: number, h: number): { w: number; h: number } {
    const maxW = Math.max(MIN_W, window.innerWidth - 36);
    const maxH = Math.max(MIN_H, window.innerHeight - 90);
    return {
        w: Math.round(Math.min(Math.max(w, MIN_W), maxW)),
        h: Math.round(Math.min(Math.max(h, MIN_H), maxH)),
    };
}

const WorkflowBubble: React.FC = () => {
    // OPEN AND ENABLED BOTH LIVE OUTSIDE THIS COMPONENT, in workflowBubble.ts.
    // Enabled is the home screen's toggle; open changes from three places (the
    // launcher, this panel's X, and enabling it). Mirroring the shared state
    // into React state here is what makes all three agree.
    const [enabled, setEnabled] = useState(isWorkflowBubbleEnabled);
    const [open, setOpenState] = useState(isBubbleOpen);
    useEffect(() => subscribeToBubble(() => {
        setEnabled(isWorkflowBubbleEnabled());
        setOpenState(isBubbleOpen());
    }), []);
    // Stays true once opened: see the header note on why this never unmounts.
    const [mounted, setMounted] = useState(false);

    // --- size ---------------------------------------------------------------
    // localStorage: where a window sits is per-machine furniture, not a panel
    // preference that should travel with a team profile.
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
    const [resizing, setResizing] = useState(false);

    const startResize = (e: React.MouseEvent) => {
        dragRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
        setResizing(true);
        e.preventDefault();
    };

    useEffect(() => {
        const move = (e: MouseEvent) => {
            const d = dragRef.current;
            if (!d) return;
            // THE PANEL IS PINNED BOTTOM-RIGHT, so it grows up and to the LEFT:
            // dragging the handle left (negative dx) has to make it WIDER, not
            // narrower. Getting this backwards feels like the panel fighting
            // the cursor, and it is the classic version of this bug.
            setSize(clampSize(d.w - (e.clientX - d.x), d.h - (e.clientY - d.y)));
        };
        const up = () => {
            if (!dragRef.current) return;
            dragRef.current = null;
            setResizing(false);
            // Saved on RELEASE, not on every move: a drag fires mousemove
            // dozens of times a second and localStorage writes are synchronous.
            setSize((s) => {
                try { window.localStorage.setItem(SIZE_KEY, JSON.stringify(s)); } catch { /* session only */ }
                return s;
            });
        };
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

    useEffect(() => {
        if (open && !mounted) setMounted(true);
    }, [open, mounted]);

    const toggle = () => {
        if (!mounted) setMounted(true);
        setBubbleOpen(!open);
    };

    // NOTHING AT ALL WHEN IT IS OFF -- no panel, no launcher, no listeners.
    if (!enabled) return null;

    return (
        <>
            {mounted && (
                <div
                    className={"wfbub-panel" + (open ? " is-open" : "") + (resizing ? " is-resizing" : "")}
                    aria-hidden={!open}
                    style={{ width: size.w, height: size.h }}
                >
                    {/* TOP-LEFT, because the panel is pinned bottom-right and
                        that is the only corner with anywhere to go. A handle on
                        the bottom-right would drag against the two edges the
                        panel is anchored to. */}
                    <span
                        className="wfbub-resize"
                        onMouseDown={startResize}
                        title="Drag to resize"
                        aria-hidden="true"
                    />
                    <div className="wfbub-head">
                        <span className="wfbub-title"><Route size={13} /> Workflow</span>
                        <button
                            className="wfbub-close"
                            onClick={() => setBubbleOpen(false)}
                            title="Hide — your ticks are kept"
                            aria-label="Hide Workflow"
                        >
                            <X size={13} />
                        </button>
                    </div>
                    <div className="wfbub-body">
                        {/* NAVIGATES THROUGH THE MODULE, not a prop. The panel
                            floats above every screen, so it has no parent to
                            hand it an onSelectTool -- which is the reason
                            lib/navigation.ts outlived the agent it was written
                            for. */}
                        <WorkflowBoard
                            variant="panel"
                            // The panel is hidden with CSS, never unmounted, so
                            // the board has to be told when it is off screen --
                            // otherwise it polls AE forever behind a closed
                            // bubble.
                            active={open}
                            onSelectTool={(id) => { navigateToTool(id); }}
                        />
                    </div>
                </div>
            )}

            {/* HIDDEN WHILE OPEN. The panel carries its own close button in its
                header; leaving the launcher up as a second X put two close
                affordances a few pixels apart, one half behind the panel. */}
            {!open && (
                <button
                    className="wfbub-fab"
                    onClick={toggle}
                    title="The team's checklist for the creative you're on"
                    aria-label="Workflow"
                >
                    <Route size={17} />
                </button>
            )}
        </>
    );
};

export default WorkflowBubble;
