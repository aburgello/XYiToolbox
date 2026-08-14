// =============================================================================
// src/js/main/LoadingChatter.tsx
// -----------------------------------------------------------------------------
// A line under a skeleton that changes every few seconds, so a long wait reads
// as something happening rather than something stuck.
//
// IT SAYS FACTS, NEVER PROGRESS. The waits it covers are single synchronous
// evalTS calls -- ExtendScript blocks for their whole duration and there is no
// channel to report through -- so anything shaped like "42% done" or "scanning
// folder 3 of 12" would be invented. Every line here is either true for the
// whole wait or explains why the wait exists, which is the part worth knowing.
//
// The cycling is the only signal of liveness, and that is honest: the panel
// genuinely does not know how far along the host is.
import React, { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

interface Props {
    /** Shown in order, then repeated. One line is fine -- it simply won't cycle. */
    lines: string[];
    /** Long enough to read, short enough to prove it's alive. */
    intervalMs?: number;
    className?: string;
}

export const LoadingChatter: React.FC<Props> = ({ lines, intervalMs = 2600, className }) => {
    const [index, setIndex] = useState(0);
    const reduced = useReducedMotion();

    useEffect(() => {
        if (lines.length < 2) return;
        const timer = window.setInterval(
            () => setIndex((n) => (n + 1) % lines.length),
            intervalMs
        );
        return () => window.clearInterval(timer);
    }, [lines.length, intervalMs]);

    if (lines.length === 0) return null;

    return (
        <span className={"loading-chatter" + (className ? " " + className : "")}>
            <span className="loading-chatter-dot" />
            {/* mode="wait" so the outgoing line clears before the next arrives --
                crossfading two different sentences in the same spot is unreadable. */}
            <AnimatePresence mode="wait" initial={false}>
                <motion.span
                    key={index}
                    initial={reduced ? false : { opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                >
                    {lines[index % lines.length]}
                </motion.span>
            </AnimatePresence>
        </span>
    );
};

export default LoadingChatter;
