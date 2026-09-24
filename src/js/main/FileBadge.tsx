// =============================================================================
// src/js/main/FileBadge.tsx
// -----------------------------------------------------------------------------
// A small file tile that says what KIND of file something is -- "AEP", "AI",
// "PSD" -- drawn, not an image: a tinted page with a folded corner and the
// type in the app's own colour. Hand-made (no Adobe artwork, nothing to
// license), so it can go anywhere a file type needs reading at a glance.
//
// One definition, shared by the Localise screen's Library card and the
// Localised Library itself, so the two cannot drift into different colours
// for the same kind of file.
// =============================================================================
import React from "react";
import "./FileBadge.scss";

/** Every spelling of a kind folds to one tile: .aet is an AEP, .eps an AI,
 *  .jpeg a JPG, .mp4 a MOV -- the same grouping Localised Library files by. */
const KIND_OF: Record<string, string> = {
    aep: "AEP", aet: "AEP",
    ai: "AI", eps: "AI",
    psd: "PSD",
    png: "PNG",
    jpg: "JPG", jpeg: "JPG",
    mov: "MOV", mp4: "MOV",
    pdf: "PDF",
};

/** The badge's kind for a path, an extension or a bucket name, or "" when
 *  it is none of the known kinds (a custom folder, "Other"). */
export function fileKindOf(pathOrExtOrName: string): string {
    const s = String(pathOrExtOrName || "").trim();
    const dot = s.lastIndexOf(".");
    const ext = (dot >= 0 ? s.slice(dot + 1) : s).toLowerCase();
    return KIND_OF[ext] || "";
}

interface Props {
    /** A path, an extension or a kind ("AEP"); unknown kinds draw a grey tile
     *  with whatever short text they carry. */
    of: string;
    size?: "sm" | "md";
    className?: string;
}

const FileBadge: React.FC<Props> = ({ of, size = "sm", className }) => {
    const kind = fileKindOf(of);
    const text = kind || String(of || "").replace(/^.*\./, "").slice(0, 4).toUpperCase() || "?";
    return (
        <span
            className={"file-badge file-badge--" + size + " file-badge--" + (kind ? kind.toLowerCase() : "other") + (className ? " " + className : "")}
            aria-hidden="true"
        >
            {text}
        </span>
    );
};

export default FileBadge;
