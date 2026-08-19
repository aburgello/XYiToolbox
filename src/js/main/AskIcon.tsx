// =============================================================================
// src/js/main/AskIcon.tsx
// -----------------------------------------------------------------------------
// The Ask agent's mark: Remix Icon's `chat-ai-line`.
//
// A speech bubble with a sparkle rather than lucide's `Bot`, which reads as a
// toy robot and sat oddly against the rest of the panel's line iconography.
//
// INLINED RATHER THAN INSTALLED. Pulling in remixicon or an Iconify runtime for
// one glyph would add a dependency and, worse, a package whose icons are
// fetched or tree-shaken differently from lucide's -- and this panel ships as a
// single self-contained bundle with no CSS code-splitting and no runtime chunk
// fetches (see CLAUDE.md section 3). One path costs nothing and cannot break
// that.
//
// The path is Remix Icon's own, copied verbatim from their published SVG rather
// than redrawn, because hand-approximated path data is how an icon ends up
// subtly wrong at 14px. Remix Icon is Apache-2.0 licensed.
//
// Matches lucide's component shape -- a `size` prop, `currentColor` fill -- so
// it drops into the same places their icons already sit.
// =============================================================================
import React from "react";

const AskIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        // Decorative: every button carrying this already has its own accessible
        // name, so announcing the glyph as well would only be noise.
        aria-hidden="true"
        focusable="false"
    >
        <path
            fill="currentColor"
            d="m20.713 8.128l-.246.566a.506.506 0 0 1-.934 0l-.246-.566a4.36 4.36 0 0 0-2.22-2.25l-.759-.339a.53.53 0 0 1 0-.963l.717-.319a4.37 4.37 0 0 0 2.251-2.326l.253-.611a.506.506 0 0 1 .942 0l.253.61a4.37 4.37 0 0 0 2.25 2.327l.718.32a.53.53 0 0 1 0 .962l-.76.338a4.36 4.36 0 0 0-2.219 2.251M10 3h4v2h-4a6 6 0 0 0-6 6c0 3.61 2.462 5.966 8 8.48V17h2a6 6 0 0 0 6-6h2a8 8 0 0 1-8 8v3.5c-5-2-12-5-12-11.5a8 8 0 0 1 8-8"
        />
    </svg>
);

export default AskIcon;
