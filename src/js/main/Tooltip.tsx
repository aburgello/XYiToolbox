// =============================================================================
// src/js/main/Tooltip.tsx
// -----------------------------------------------------------------------------
// A styled hover tooltip to replace the native `title` attribute, which
// always renders as the browser/OS's own square, unstyled tooltip no matter
// what CSS is applied to the element it's on. Wrap anything in <Tooltip
// text="...">...</Tooltip> instead of using title="..." directly.
//
// Rendered via a React portal into document.body, positioned with
// `position: fixed` and pixel coordinates computed from getBoundingClientRect()
// -- NOT `position: absolute` nested under the trigger. That's a deliberate
// fix, not the original design: any trigger sitting inside a scrolling list
// (OV Library's render rows, any .form-tool page's own `overflow-y: auto`)
// would have the bubble clipped by that list's own overflow box, even though
// the JS placement math was already correctly computed against the panel
// viewport -- CSS position:absolute is still contained by the nearest
// scrolling/overflow ancestor regardless of where the numbers say it should
// go. A portal escapes every ancestor's overflow and stacking context, so
// the bubble can only ever be clipped by the panel's own edges (which the
// placement/clamping logic already accounts for).
//
// Placement flips between above/below the trigger based on which side has
// more room (see updatePosition()) instead of always rendering above -- in a
// tightly-packed grid (e.g. Toolset's action grid), "always above" pushed
// the bubble straight into whatever row/group sits above it.
//
// Horizontal clamping keeps the bubble from running off the panel's left/
// right edge (window bounds ARE the panel's own bounds in a CEP panel), and
// the arrow's position is computed separately so it still points at the
// actual trigger even when the bubble itself has been nudged to stay
// on-screen.
// =============================================================================
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.scss";

const EDGE_MARGIN = 8;
const GAP = 8; // space between trigger and bubble

interface Pos {
    top: number;
    left: number;
    arrowLeft: number;
    placement: "top" | "bottom";
}

// Module-level, shared by every Tooltip instance: at most one tooltip
// should ever be visible at once. Native mouseenter/mouseleave aren't
// fully reliable in a CEP/Chromium panel -- fast pointer movement, or the
// cursor leaving straight off the panel's own window edge instead of
// crossing back over another DOM element, can skip firing mouseleave
// entirely, which otherwise leaves a bubble stuck open forever with no
// event left to close it. Rather than rely on catching every leave event,
// showing any tooltip force-hides whichever one was previously active, so
// stale bubbles can never pile up regardless of what caused the miss.
// Keyed by a stable per-instance id (a ref object), not a function
// reference, since a function closure captured on one render wouldn't
// still `===` the one on a later render after any re-render.
let activeTooltip: { id: object; hide: () => void } | null = null;

const Tooltip = ({
    text,
    children,
    delay = 0,
    grow = false,
}: {
    text: string;
    children: React.ReactNode;
    // Hover hold time (ms) before the bubble shows. Default 0 keeps existing
    // instant-on-hover behavior (e.g. OV Library's path tooltips, hovered
    // deliberately one at a time). Callers with a dense always-visible grid
    // the user's cursor naturally sweeps across while just scanning (e.g.
    // Toolset's action grid) should pass a real delay -- otherwise a bubble
    // pops up under the cursor for every button passed over on the way to
    // the one actually wanted, which reads as spammy rather than helpful.
    delay?: number;
    // Opt-in: stretches wrapper -> content -> the wrapped element together
    // to fill whatever flex:1/grid-stretch slot the wrapped element used to
    // occupy on its own, instead of the default (wrapper hugs the wrapped
    // element's own natural size). Needed for triggers that rely on being a
    // flex-grow or grid-auto-stretch item themselves -- icon-button rows,
    // a CSS grid of cells, a tab bar -- since .ov-tooltip-content's forced
    // `flex: 0 0 auto` (below) otherwise shrinks them to content size and
    // leaves an invisible unhoverable gap where the fill used to be. See
    // XYToolsDroplet.tsx's header comment for the two ways this has
    // already bitten this app without this escape hatch.
    grow?: boolean;
}) => {
    const wrapperRef = useRef<HTMLSpanElement>(null);
    // Measured separately from wrapperRef: the wrapper is a plain <span>, and
    // some callers sit inside a flex row with a generic `span { flex: 1 }`
    // rule (e.g. OVLibrary's action rows) meant for the visible label --
    // that rule matches this wrapper too and stretches it to fill the row,
    // so its own rect is nowhere near the text the user is actually
    // hovering. This inner span never grows, so it always hugs the real
    // visible content, and that's what placement math should center on.
    const contentRef = useRef<HTMLSpanElement>(null);
    const bubbleRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [pos, setPos] = useState<Pos | null>(null);
    const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Stable identity for the activeTooltip singleton -- a plain object
    // created once, never a function closure (those change every render).
    const idRef = useRef({});

    // Re-measured every time the bubble becomes visible (not cached), since
    // scrolling/resizing the panel changes how much room is actually
    // available around the trigger, and the trigger may have moved.
    const updatePosition = () => {
        const wrapperEl = contentRef.current;
        const bubbleEl = bubbleRef.current;
        if (!wrapperEl || !bubbleEl) return;

        const wrapperRect = wrapperEl.getBoundingClientRect();
        const bubbleRect = bubbleEl.getBoundingClientRect();
        const spaceAbove = wrapperRect.top;
        const spaceBelow = window.innerHeight - wrapperRect.bottom;
        const placement: "top" | "bottom" = spaceBelow > spaceAbove ? "bottom" : "top";

        const wrapperCenterX = wrapperRect.left + wrapperRect.width / 2;
        let left = wrapperCenterX - bubbleRect.width / 2;
        left = Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - bubbleRect.width - EDGE_MARGIN));

        const top = placement === "top" ? wrapperRect.top - bubbleRect.height - GAP : wrapperRect.bottom + GAP;

        // Arrow points at the trigger's actual center, clamped so it never
        // renders past the bubble's own rounded corners.
        const arrowLeft = Math.max(10, Math.min(wrapperCenterX - left, bubbleRect.width - 10));

        setPos({ top, left, arrowLeft, placement });
    };

    // Runs synchronously after the (invisible, off-screen) bubble mounts but
    // before the browser paints, so there's no visible flash at the wrong
    // position on first show.
    useLayoutEffect(() => {
        if (visible) updatePosition();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, text]);

    const clearShowTimeout = () => {
        if (showTimeoutRef.current !== null) {
            clearTimeout(showTimeoutRef.current);
            showTimeoutRef.current = null;
        }
    };
    const hide = () => {
        clearShowTimeout();
        setVisible(false);
        setPos(null);
        // Only clear the singleton if it's still pointing at this instance --
        // if another tooltip already took over (see doShow below), this
        // hide() firing late (e.g. a leave event that arrives after a
        // different trigger already force-hid this one) must not clobber
        // the new active tooltip's own entry.
        if (activeTooltip && activeTooltip.id === idRef.current) activeTooltip = null;
    };
    const show = () => {
        const doShow = () => {
            if (activeTooltip && activeTooltip.id !== idRef.current) activeTooltip.hide();
            activeTooltip = { id: idRef.current, hide };
            setVisible(true);
        };
        if (delay > 0) {
            // Cursor has to hold still on THIS trigger for the full delay --
            // moving to a different trigger unmounts/remounts this timeout
            // via hide(), it doesn't carry over.
            showTimeoutRef.current = setTimeout(doShow, delay);
        } else {
            doShow();
        }
    };

    useEffect(() => clearShowTimeout, []);

    // Fallback for missed mouseleave events (see the activeTooltip comment
    // above): while this bubble is visible, independently verify the
    // cursor is still actually over the trigger, self-healing even in the
    // single-tooltip case where there's no *other* tooltip's show() to
    // force this one closed. Only attached while visible, not always-on.
    useEffect(() => {
        if (!visible) return;
        const checkStillHovering = (e: MouseEvent) => {
            const el = wrapperRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (!inside) hide();
        };
        document.addEventListener("mousemove", checkStillHovering);
        return () => document.removeEventListener("mousemove", checkStillHovering);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    return (
        <span
            ref={wrapperRef}
            className={"ov-tooltip-wrapper" + (grow ? " ov-tooltip-grow" : "")}
            onMouseEnter={show}
            onMouseLeave={hide}
        >
            <span ref={contentRef} className="ov-tooltip-content">
                {children}
            </span>
            {visible &&
                createPortal(
                    <div
                        ref={bubbleRef}
                        className={`ov-tooltip-bubble ov-tooltip-${pos?.placement || "top"}${pos ? " ov-tooltip-ready" : ""}`}
                        style={
                            pos
                                ? ({ top: pos.top, left: pos.left, "--tooltip-arrow-left": `${pos.arrowLeft}px` } as React.CSSProperties)
                                : // Off-screen until the first measurement lands, so it never flashes at (0,0).
                                  { top: -9999, left: -9999 }
                        }
                    >
                        {text}
                    </div>,
                    document.body
                )}
        </span>
    );
};

export default Tooltip;
