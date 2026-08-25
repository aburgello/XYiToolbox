// =============================================================================
// src/js/main/TutorialIcon.tsx
// -----------------------------------------------------------------------------
// A tool's header icon, which becomes a play button when somebody has recorded
// a tutorial for that tool (a clip in <TeamFolder>/_tuts/ named after it -- see
// lib/tutorials.ts). Clicking it plays the clip in an overlay over the panel.
//
// THE AFFORDANCE ONLY EXISTS WHEN THE CLIP DOES. No badge, no cursor change, no
// hover, no click when there is no tutorial -- it renders exactly the icon it
// always did. An icon that looks pressable on all forty tools and does nothing
// on thirty-nine teaches everybody to stop pressing it, which would take the
// three tools that DO have a clip down with it.
//
// A SPAN with role="button", not a <button>: this replaces four existing header
// icons whose own classes carry their backgrounds (`.ls-header-icon`'s gradient
// tile among them), and index.scss's global `button:hover`/`:active` would
// paint straight over every one of them. Keyboard activation is wired by hand
// because that is what a span costs.
// =============================================================================
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Play } from "lucide-react";
import { tutorialFor, type Tutorial } from "./lib/tutorials";
import { getTutorialSubject, subscribeTutorialSubject } from "./lib/tutorialSubject";
import { VideoOverlay } from "./VideoOverlay";
import "./TutorialIcon.scss";

interface Props {
    toolId: string;
    toolLabel: string;
    /** The class the call site already used for its icon -- kept verbatim. */
    className: string;
    /** "pop" matches LocaliseScreen's existing scale+rotate on its tile. */
    hover?: "pop" | "lift";
    children: React.ReactNode;
}

export const TutorialIcon: React.FC<Props> = ({ toolId, toolLabel, className, hover = "lift", children }) => {
    const [tutorial, setTutorial] = useState<Tutorial | null>(null);
    const [playing, setPlaying] = useState(false);
    // WHAT THIS ICON IS ABOUT RIGHT NOW. Almost always the tool it sits on;
    // Bespoke is the exception, where the mode you picked at the door is a
    // different subject to the tool that offered it. See lib/tutorialSubject.
    const [subject, setSubject] = useState(getTutorialSubject);

    useEffect(() => {
        // Read once on mount as well as on change: the tool below this header
        // sets its subject while mounting, which can land before this
        // subscribes.
        setSubject(getTutorialSubject());
        return subscribeTutorialSubject(() => setSubject(getTutorialSubject()));
    }, []);

    // Scoped to this tool -- a subject belonging to another one is not ours to
    // show, which is what keeps a stale mode off every other tool's header.
    const mine = subject && subject.toolId === toolId ? subject : null;
    const lookupId = mine ? mine.id : toolId;
    const lookupLabel = mine ? mine.label : toolLabel;

    useEffect(() => {
        // Guarded against landing after the tool has been navigated away from:
        // the list is cached so this usually resolves immediately, but the
        // FIRST lookup of a session is a real NAS round-trip and somebody
        // clicking through tools quickly will outrun it.
        let live = true;
        setTutorial(null);
        tutorialFor(lookupId, lookupLabel).then((t) => {
            if (live) setTutorial(t);
        });
        return () => {
            live = false;
        };
    }, [lookupId, lookupLabel]);

    // The hover the icon had before this existed, unchanged, so a tool with no
    // clip looks and moves exactly as it did.
    const hoverAnim = !tutorial
        ? undefined
        : hover === "pop"
        ? { scale: 1.15, rotate: 8 }
        : { scale: 1.08 };

    const open = () => setPlaying(true);

    return (
        <>
            <motion.span
                className={className + (tutorial ? " has-tutorial" : "")}
                whileHover={hoverAnim}
                whileTap={tutorial ? { scale: 0.95 } : undefined}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                role={tutorial ? "button" : undefined}
                tabIndex={tutorial ? 0 : undefined}
                title={tutorial ? "Watch the " + lookupLabel + " tutorial" : undefined}
                aria-label={tutorial ? "Watch the " + lookupLabel + " tutorial" : undefined}
                onClick={tutorial ? open : undefined}
                onKeyDown={
                    tutorial
                        ? (e: React.KeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  open();
                              }
                          }
                        : undefined
                }
            >
                {children}
                <AnimatePresence>
                    {tutorial && (
                        <motion.span
                            className="tutorial-play-badge"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            // Arrives a beat after the icon rather than with
                            // it: the clip list is a NAS read, so the badge
                            // appearing IS news, and popping it in silently
                            // under the cursor reads as a glitch.
                            transition={{ type: "spring", stiffness: 500, damping: 22, delay: 0.12 }}
                        >
                            <Play size={7} fill="currentColor" strokeWidth={0} />
                        </motion.span>
                    )}
                </AnimatePresence>
            </motion.span>
            <AnimatePresence>
                {playing && tutorial && (
                    <VideoOverlay
                        path={tutorial.path}
                        title={lookupLabel + " — tutorial"}
                        errorHint="The clip lives in the team folder's _tuts. If the share just mounted, reopen the tool."
                        onClose={() => setPlaying(false)}
                    />
                )}
            </AnimatePresence>
        </>
    );
};

export default TutorialIcon;
