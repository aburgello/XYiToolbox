// =============================================================================
// src/js/main/VideoOverlay.tsx
// -----------------------------------------------------------------------------
// Plays a local video file centered over the whole panel, with native <video>
// controls. Closes on Escape, on backdrop click, or via the X.
//
// Was OVLibrary's private VideoPlayerModal until the tutorial overlay needed
// the same thing. Two differences from the original, both because it now
// serves two callers:
//
//  - The failure copy is a prop. OVLibrary's ("the render works in After
//    Effects, try Import or Reveal") is right for a render and nonsense for a
//    tutorial clip on the NAS.
//  - An optional title bar, for when the file's name is not visible anywhere
//    else on screen. OVLibrary's player is opened from a row that already
//    names the render, so it passes none.
//
// Rendered through a PORTAL to <body>. It is opened from inside a tool's
// content, and a `position: fixed` element still gets clipped by an ancestor
// with `overflow`/`transform` -- the same trap Tooltip's bubble hit. Which
// also means the category tint has to be re-applied here, per CLAUDE.md:
// --cat-* is an inline style on the mounted tool, and portaled content lands
// outside it.
// =============================================================================
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X, Film } from "lucide-react";
import { toFileUrl } from "./lib/fileUrl";
import "./VideoOverlay.scss";

interface Props {
    /** OS path to the file -- converted to file:// here, don't pre-convert. */
    path: string;
    onClose: () => void;
    /** Shown above the video when the file isn't named elsewhere on screen. */
    title?: string;
    /** Replaces the generic "couldn't play this" hint line. */
    errorHint?: string;
}

export const VideoOverlay: React.FC<Props> = ({ path, onClose, title, errorHint }) => {
    const [error, setError] = React.useState(false);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return createPortal(
        <motion.div
            className="video-player-overlay"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
        >
            <motion.div
                className="video-player-frame"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
                <button className="video-player-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
                    <X size={16} />
                </button>
                {title && <div className="video-player-title">{title}</div>}
                {error ? (
                    <div className="video-player-error">
                        <Film size={32} />
                        <p>Could not play this file in the panel.</p>
                        {errorHint && <p className="hint">{errorHint}</p>}
                    </div>
                ) : (
                    <video src={toFileUrl(path)} controls autoPlay onError={() => setError(true)} />
                )}
            </motion.div>
        </motion.div>,
        document.body
    );
};

export default VideoOverlay;
