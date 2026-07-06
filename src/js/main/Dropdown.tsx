// =============================================================================
// src/js/main/Dropdown.tsx
// -----------------------------------------------------------------------------
// A themed replacement for a native <select>, built on the same anchored-
// popover primitive (Droplet.tsx) already used for Toggle By Label/Comp
// Duration/Timesheet/Sfx pickers -- not a new positioning mechanism.
//
// Why this exists: a native <select>'s CLOSED box is fully stylable, but the
// OPEN option list is a browser/OS-native popup -- only an <option>'s own
// resting background/color can be styled (shared.scss's `select option`
// rule), and the list's hover/selected-row HIGHLIGHT is drawn by the OS and
// cannot be recolored via CSS in any browser. That's a genuine platform
// ceiling, confirmed while investigating Localised Library's campaign picker
// (its selected row rendered grey instead of teal no matter what CSS was
// tried). The only real fix is to stop using a native <select> for the OPEN
// list and render our own, which is what this component does -- the trigger
// still looks and behaves like a normal dropdown box, but the list that pops
// open is ordinary themed DOM, so the selected/hovered row can finally use
// the same --cat-* teal/purple/orange/pink accent every other selected-state
// row in this app already uses (rail tool rows, territory rows, etc.).
//
// Scope: first wired into Localised Library's campaign picker specifically
// (that's what was asked for). Generic on purpose so the same component can
// replace Timesheet Tracker's category <select> or OV Library's orientation
// filter later without rebuilding this -- not done proactively, only if/when
// asked, per this project's "don't extend a narrow fix without being asked"
// convention (see CLAUDE.md's pingLoc/jpgLoc exception notes for the same
// reasoning applied elsewhere).
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import Droplet from "./Droplet";
import "./Dropdown.scss";

export interface DropdownOption {
    value: string;
    label: string;
}

interface Props {
    value: string;
    onChange: (value: string) => void;
    options: DropdownOption[];
    placeholder?: string;
    icon?: React.ReactNode;
    disabled?: boolean;
    /** Extra class on the trigger box, for per-use layout (matches the old wrapper's className slot). */
    className?: string;
    emptyMessage?: string;
}

const Dropdown: React.FC<Props> = ({ value, onChange, options, placeholder = "Select…", icon, disabled, className, emptyMessage = "Nothing to select yet." }) => {
    const selected = options.find((o) => o.value === value) || null;
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const listRef = useRef<HTMLDivElement>(null);

    return (
        <Droplet
            panelClassName="dropdown-panel"
            trigger={({ open, toggle }) => (
                <button
                    type="button"
                    className={"dropdown-trigger" + (className ? " " + className : "") + (open ? " open" : "") + (disabled ? " disabled" : "")}
                    disabled={disabled}
                    onClick={() => {
                        if (!open) setFocusedIndex(Math.max(0, options.findIndex((o) => o.value === value)));
                        toggle();
                    }}
                >
                    {icon && <span className="dropdown-trigger-icon">{icon}</span>}
                    <span className={"dropdown-trigger-label" + (selected ? "" : " placeholder")}>
                        {selected ? selected.label : placeholder}
                    </span>
                    <ChevronDown size={13} className="dropdown-trigger-chevron" />
                </button>
            )}
        >
            {(close) => {
                // Keyboard nav lives inside the render-prop, scoped to while the
                // panel is actually open -- Droplet already handles Escape/outside-
                // click, this only adds Arrow/Enter on top of that.
                const onKeyDown = (e: React.KeyboardEvent) => {
                    if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setFocusedIndex((i) => Math.min(options.length - 1, i + 1));
                    } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setFocusedIndex((i) => Math.max(0, i - 1));
                    } else if (e.key === "Enter") {
                        e.preventDefault();
                        const opt = options[focusedIndex];
                        if (opt) {
                            onChange(opt.value);
                            close();
                        }
                    }
                };

                return (
                    <div
                        className="dropdown-list"
                        ref={(el) => {
                            listRef.current = el;
                            // Autofocus on mount so Arrow/Enter work immediately without
                            // an extra click into the panel -- matches a native <select>'s
                            // own "opens already keyboard-navigable" behavior.
                            if (el) el.focus();
                        }}
                        onKeyDown={onKeyDown}
                        tabIndex={-1}
                        role="listbox"
                    >
                        {options.length === 0 && <div className="dropdown-empty">{emptyMessage}</div>}
                        {options.map((opt, i) => (
                            <button
                                type="button"
                                key={opt.value}
                                role="option"
                                aria-selected={opt.value === value}
                                className={
                                    "dropdown-option" +
                                    (opt.value === value ? " selected" : "") +
                                    (i === focusedIndex ? " focused" : "")
                                }
                                onMouseEnter={() => setFocusedIndex(i)}
                                onClick={() => {
                                    onChange(opt.value);
                                    close();
                                }}
                            >
                                <span className="dropdown-option-label">{opt.label}</span>
                                {opt.value === value && <Check size={13} className="dropdown-option-check" />}
                            </button>
                        ))}
                    </div>
                );
            }}
        </Droplet>
    );
};

export default Dropdown;
