// =============================================================================
// src/js/main/HomeButton.tsx
// -----------------------------------------------------------------------------
// Straight back to the home screen, from anywhere.
//
// Back walks the stack one step at a time, which is right when you took one
// wrong turn and wrong when you have followed a workflow through three tools —
// getting home then means pressing Back until it stops changing anything.
//
// ITS OWN COMPONENT rather than five copies of the markup: it sits beside the
// back button on ToolScreen, CategoryScreen, ToolsScreen and both of
// LocaliseScreen's headers, and five hand-written copies of a control this
// small is five places for the label, the icon size or the hover to drift
// apart.
// =============================================================================
import React from "react";
import { motion } from "motion/react";
import { Home } from "lucide-react";
// A `title`, NOT a <Tooltip>, and that is a layout decision rather than a
// stylistic one. Tooltip wraps its child in a span carrying
// `flex: 0 0 auto !important`, so the SPAN becomes the flex item and the
// button inside it stops participating in the row — `margin-right: auto`,
// which is what groups this next to Back, silently did nothing. Same family
// as CLAUDE.md's rule about wrapping a stretch-sized element in Tooltip.
// Back is a plain button with no tooltip either, so this also matches its
// neighbour.
const HomeButton: React.FC<{ onHome: () => void }> = ({ onHome }) => (
    <motion.button
        className="home-button"
        onClick={onHome}
        aria-label="Home"
        title="Back to the home screen"
        // Lifts rather than sliding: Back slides LEFT on hover, and a
        // neighbour sliding the same way would read as the same control
        // twice. Different motion, different meaning.
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.94 }}
    >
        <Home size={14} />
    </motion.button>
);

export default HomeButton;
