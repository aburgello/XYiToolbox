// =============================================================================
// src/js/main/Droplet.tsx
// -----------------------------------------------------------------------------
// A small anchored popover that reveals below (or above, if there's no room)
// a trigger element on click -- for a quick in-place pick (a handful of
// options) that doesn't deserve a full modal. First use: Toolset.tsx's
// Toggle By Label (color swatches) and Comp Duration (preset chips), to
// replace what used to be a `selectDialog()` modal for both.
//
// Positioning is deliberately modeled on Tooltip.tsx's already-solved
// portal + position:fixed + edge-clamping approach (see that file's own
// header comment for the full history of why: position:absolute under the
// trigger gets clipped by any scrolling ancestor's overflow, a portal to
// document.body escapes that entirely) -- same technique, adapted for a
// click-toggled, INTERACTIVE panel instead of a hover-only text bubble:
//   - No "still hovering" mouse-tracking fallback (Tooltip needs that
//     because native mouseenter/mouseleave can be missed at high pointer
//     speed; a click-toggled panel has no such gap to guard against).
//   - Closes on outside click, Escape, or the content calling the `close`
//     it's handed -- not on mouseleave.
//   - Content is an arbitrary interactive render-prop (buttons, inputs),
//     not a fixed text string.
// Same singleton-via-module-scope pattern as Tooltip's `activeTooltip` --
// opening one droplet force-closes any other, so two can never be open
// at once and cluttering the panel.
// =============================================================================
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import "./Droplet.scss";

const EDGE_MARGIN = 8;
const GAP = 6;

interface Pos {
    top: number;
    left: number;
    placement: "top" | "bottom";
}

let activeDroplet: { id: object; close: () => void } | null = null;

interface Props {
    trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
    /** Render-prop so content can call `close()` itself (e.g. after picking an option). */
    children: (close: () => void) => React.ReactNode;
    /** Extra class on the portaled panel, for per-use width/layout. */
    panelClassName?: string;
}

const Droplet: React.FC<Props> = ({ trigger, children, panelClassName }) => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<Pos | null>(null);
    const anchorRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const idRef = useRef({});

    const close = () => {
        setOpen(false);
        setPos(null);
        if (activeDroplet && activeDroplet.id === idRef.current) activeDroplet = null;
    };

    const toggle = () => {
        if (open) {
            close();
            return;
        }
        if (activeDroplet && activeDroplet.id !== idRef.current) activeDroplet.close();
        activeDroplet = { id: idRef.current, close };
        setOpen(true);
    };

    const updatePosition = () => {
        const anchorEl = anchorRef.current;
        const panelEl = panelRef.current;
        if (!anchorEl || !panelEl) return;

        const anchorRect = anchorEl.getBoundingClientRect();
        const panelRect = panelEl.getBoundingClientRect();
        const spaceBelow = window.innerHeight - anchorRect.bottom;
        const spaceAbove = anchorRect.top;
        const placement: "top" | "bottom" = spaceBelow >= panelRect.height + GAP || spaceBelow >= spaceAbove ? "bottom" : "top";

        let left = anchorRect.left;
        left = Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - panelRect.width - EDGE_MARGIN));

        const top = placement === "bottom" ? anchorRect.bottom + GAP : anchorRect.top - panelRect.height - GAP;

        setPos({ top, left, placement });
    };

    // Runs synchronously after the (invisible, off-screen) panel mounts but
    // before paint -- same reasoning as Tooltip's own useLayoutEffect, no
    // flash at the wrong position on first open.
    useLayoutEffect(() => {
        if (open) updatePosition();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDocPointerDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (anchorRef.current?.contains(target)) return; // trigger itself toggles, don't double-handle
            if (panelRef.current?.contains(target)) return;
            close();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        const onReposition = () => updatePosition();
        document.addEventListener("mousedown", onDocPointerDown);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", onReposition);
        window.addEventListener("scroll", onReposition, true);
        return () => {
            document.removeEventListener("mousedown", onDocPointerDown);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", onReposition);
            window.removeEventListener("scroll", onReposition, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <span ref={anchorRef} className="droplet-anchor">
            {trigger({ open, toggle })}
            {open &&
                createPortal(
                    <AnimatePresence>
                        <motion.div
                            ref={panelRef}
                            className={"droplet-panel" + (panelClassName ? " " + panelClassName : "")}
                            style={
                                pos
                                    ? { top: pos.top, left: pos.left }
                                    : { top: -9999, left: -9999 } // off-screen until first measurement lands
                            }
                            initial={{ opacity: 0, scale: 0.95, y: pos?.placement === "top" ? 4 : -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ type: "spring", stiffness: 460, damping: 32 }}
                        >
                            {children(close)}
                        </motion.div>
                    </AnimatePresence>,
                    document.body
                )}
        </span>
    );
};

export default Droplet;
