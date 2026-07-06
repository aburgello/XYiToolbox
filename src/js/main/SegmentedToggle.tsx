// =============================================================================
// src/js/main/SegmentedToggle.tsx
// -----------------------------------------------------------------------------
// A small pill segmented control for a mutually-exclusive choice (the CEP
// replacement for a pair of native <input type="radio">, which render as an
// unstyled OS dot that doesn't match this panel's aesthetic — same reason
// CheckboxToggle exists for checkboxes). The active segment is highlighted
// with the category-tinted --cat-* vars; a Framer `layoutId` slides the
// highlight between segments.
//
// Usage:
//   <SegmentedToggle
//     value={isInternational ? "intl" : "dom"}
//     onChange={(v) => setIsInternational(v === "intl")}
//     options={[{ value: "intl", label: "International" }, { value: "dom", label: "Domestic" }]}
//   />
// =============================================================================
import React from "react";
import { motion, useReducedMotion } from "motion/react";
import "./SegmentedToggle.scss";

interface Option {
    value: string;
    label: string;
}

interface Props {
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    /** Unique id so multiple toggles on one page don't share a layoutId. */
    name?: string;
}

const SegmentedToggle: React.FC<Props> = ({ value, onChange, options, name = "seg" }) => {
    const reduced = useReducedMotion();
    return (
        <div className="segmented-toggle" role="radiogroup">
            {options.map((opt) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={active ? "seg-option active" : "seg-option"}
                        onClick={() => onChange(opt.value)}
                    >
                        {active && (
                            <motion.span
                                className="seg-highlight"
                                layoutId={`seg-highlight-${name}`}
                                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }}
                            />
                        )}
                        <span className="seg-label">{opt.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default SegmentedToggle;
