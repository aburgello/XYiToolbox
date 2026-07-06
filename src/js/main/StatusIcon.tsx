// =============================================================================
// src/js/main/StatusIcon.tsx
// -----------------------------------------------------------------------------
// Animated success/error icon for the app-wide status/toast pattern
// (`{ type: "success" | "error" }`) used by nearly every tool file --
// originally written inline in OVLibrary.tsx's toast rendering, pulled out
// here once the same treatment was wanted everywhere rather than
// copy-pasted 20+ times (see CLAUDE.md's OV Library visual polish pass).
//
// Success gets a calm spring "pop" plus a single non-looping ring pulse
// (the ring keyframe lives in shared.scss's .status-success-icon, since
// every tool already imports shared.scss -- no per-tool CSS needed).
// Error is deliberately just a plain fade-in, no pop -- a failure
// shouldn't get the same celebratory motion as a success.
//
// Tuned calmer than the first version shipped in OVLibrary.tsx: that one
// used rotate: -45deg and damping: 15, which produced a visible bounce/
// overshoot loud enough to read as "too big" for something that fires on
// every single completed action, all day. This version keeps the "it
// popped in" feeling without the wobble.
// =============================================================================
import React from "react";
import { motion } from "motion/react";
import { CheckCircle2, AlertCircle } from "lucide-react";

const StatusIcon = ({ type, size = 14 }: { type: "success" | "error"; size?: number }) => {
    if (type === "error") return <AlertCircle size={size} />;

    return (
        <motion.span
            className="status-success-icon"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
        >
            <CheckCircle2 size={size} />
        </motion.span>
    );
};

export default StatusIcon;
