// =============================================================================
// src/js/main/CheckboxToggle.tsx
// -----------------------------------------------------------------------------
// A checkbox rendered as a Square/CheckSquare icon button instead of a
// native <input type="checkbox">, so it matches this app's fully custom
// dark UI instead of sitting in it as an unstyled native OS control (the
// exact complaint that started this: DeliveryHub's Audio toggle looked
// "weird" next to everything else on the page).
//
// This exact pattern had already been reinvented independently twice
// before being pulled out here (LocalisedLibrary.tsx's batch-select
// checkboxes, DeliveryHub.tsx's Audio toggle) -- rather than copy-pasting
// it an 11th+ time across every other tool's own checkbox fields
// (CSVLocaliser, CampaignLocaliser, CheekyDT, EditGenerator,
// GenerateCueSheet, OVLibrary), it's a shared component now, alongside
// Tooltip.tsx/Dialog.tsx/Droplet.tsx as this app's other shared UI
// primitives.
// =============================================================================
import React from "react";
import { CheckSquare, Square } from "lucide-react";
import "./CheckboxToggle.scss";

interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: React.ReactNode;
    title?: string;
    className?: string;
}

const CheckboxToggle: React.FC<Props> = ({ checked, onChange, label, title, className }) => (
    <button
        type="button"
        className={`checkbox-toggle${checked ? " active" : ""}${className ? " " + className : ""}`}
        onClick={() => onChange(!checked)}
        title={title}
    >
        {checked ? <CheckSquare size={13} /> : <Square size={13} />}
        {label}
    </button>
);

export default CheckboxToggle;
