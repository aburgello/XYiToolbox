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
import React, { useState } from "react";
import { Bot, X } from "lucide-react";
import AgentChat from "./tools/AgentChat";
import "./AgentBubble.scss";

const AgentBubble: React.FC = () => {
    const [open, setOpen] = useState(false);
    // Stays true once opened: see the header note on why this never unmounts.
    const [mounted, setMounted] = useState(false);
    // Bumped on every open so the ask box takes focus. A mount effect cannot
    // do this job -- the panel is hidden with CSS rather than unmounted, so it
    // only ever mounts once.
    const [focusKey, setFocusKey] = useState(0);
    // The header node AgentChat renders its status controls into. See the slot
    // in the markup below for why this is state and not a ref.
    const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);

    const toggle = () => {
        if (!mounted) setMounted(true);
        setOpen((v) => {
            if (!v) setFocusKey((k) => k + 1);
            return !v;
        });
    };

    return (
        <>
            {mounted && (
                <div className={"agent-bubble-panel" + (open ? " is-open" : "")} aria-hidden={!open}>
                    <div className="agent-bubble-head">
                        <span className="agent-bubble-title"><Bot size={14} /> Ask</span>
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
                    <Bot size={18} />
                </button>
            )}
        </>
    );
};

export default AgentBubble;
