// =============================================================================
// src/js/main/AskAbout.tsx
// -----------------------------------------------------------------------------
// "Ask about this" — a button that hands the agent a question from wherever the
// artist already is, instead of making them open the bubble and find the words.
//
// A SHARED COMPONENT SO PLACEMENTS CANNOT DRIFT. The two rules below have to
// hold everywhere this appears, and re-deriving them at each site is how one of
// them quietly stops being true:
//
//   1. IT IS NOT THERE WHEN THE AGENT IS OFF. Opt-in means the panel looks
//      untouched for somebody who never wanted it -- a button that turned the
//      feature on by being pressed would make the setting meaningless.
//   2. IT COSTS MONEY AND MUST LOOK LIKE IT DOES. This spends a few cents of
//      somebody's API budget on one click, so it carries the agent's own mark
//      rather than passing for an ordinary panel button.
//
// EARN EACH PLACEMENT. The test is not "could the agent say something here" --
// it always could. It is whether there is ONE recurring question that a person
// would actually ask at this exact moment, and that the agent answers better
// than the panel already does. A spec table that has just been parsed passes:
// "is anything wrong with this?" is the next thought every time. Most screens
// do not, and a panel with one of these on every view is just noise with a
// running cost.
// =============================================================================
import React, { useEffect, useState } from "react";
import { askAgent, isAgentEnabled, subscribeToBubble } from "./lib/agent/bubbleControl";
import AskIcon from "./AskIcon";
import Tooltip from "./Tooltip";
import "./AskAbout.scss";

const AskAbout: React.FC<{
    /** The question, phrased as the artist would have typed it. */
    question: string;
    /** Button text. Short — it sits inside somebody else's layout. */
    label: string;
    /** What the tooltip says this will do. */
    hint?: string;
}> = ({ question, label, hint }) => {
    const [on, setOn] = useState(isAgentEnabled);
    // Subscribed, not read once: the agent can be switched off from the home
    // screen while this is on screen behind it.
    useEffect(() => subscribeToBubble(() => setOn(isAgentEnabled())), []);

    if (!on) return null;

    return (
        <Tooltip text={hint || "Ask about this — opens the assistant and puts the question to it"}>
            <button className="ask-about" onClick={() => askAgent(question)}>
                <AskIcon size={12} />
                <span>{label}</span>
            </button>
        </Tooltip>
    );
};

export default AskAbout;
