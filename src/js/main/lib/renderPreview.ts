// =============================================================================
// src/js/main/lib/renderPreview.ts
// -----------------------------------------------------------------------------
// SHOWING A MASTER AS THE FRAME IT ACTUALLY IS.
//
// A master is an .aep and has no thumbnail of its own, so every tool that wants
// to show one has to go and find its RENDER -- the mirrored `Renders/` tree or
// the flat `Support/Motion_Components/_mp4` folder, paired by identical stem
// (the host's scanAllRenders / scanRendersForCreative do that walk).
//
// What that leaves the panel with is a folder of mixed video files, and three
// problems that are not obvious until a grid of them is on screen. All three
// were solved once in OVLibrary.tsx and are lifted here so Bespoke's master
// cards inherit the answers rather than rediscovering them:
//
//   1. Not every render is playable. Studio folders mix ProRes MOVs Chromium
//      cannot decode at all with the H.264 MP4s it can.
//   2. Not every source is a video -- a manual override can be a still, and a
//      <video> tag shows an image src as nothing at all. No error, no fallback.
//   3. Frame 0 of a DOOH render is routinely the worst frame in the clip.
// =============================================================================
import { useRef } from "react";

/** One render found beside a master, paired to it by identical filename stem. */
export interface RenderEntry {
    stem: string;
    path: string;
}

// A thumbnail source can be either a video or an image file -- an auto-detected
// render is a video, but a manual override goes through a file picker with no
// type filter. The card renderers need to know which, since a <video> tag shows
// nothing whatsoever for an image src: no error and no fallback, which is the
// confirmed failure mode when a PNG override displayed as an empty card.
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"];

export function isImageFile(path: string): boolean {
    const dot = path.lastIndexOf(".");
    if (dot === -1) return false;
    return IMAGE_EXTS.indexOf(path.substring(dot + 1).toLowerCase()) !== -1;
}

// Prefers a web-playable extension over the host scan's raw "first found in an
// arbitrary recursive walk" order. Real Renders folders commonly mix MOV (often
// a ProRes intermediate Chromium can't decode at all) alongside MP4 (near-always
// H.264, reliably playable) -- letting the scan's arbitrary order land on an
// undecodable MOV produced exactly the "blank thumbnail" symptom this exists to
// fix. It doesn't guarantee the pick is the right render, only that it is one
// that can render at all.
const RENDER_EXT_PREFERENCE = ["mp4", "m4v", "mov", "mxf", "avi", "mts"];

export function pickPreviewRender(renders: RenderEntry[]): RenderEntry | undefined {
    if (!renders || renders.length === 0) return undefined;
    let best = renders[0];
    let bestRank = RENDER_EXT_PREFERENCE.length;
    for (const r of renders) {
        const dot = r.path.lastIndexOf(".");
        const ext = dot === -1 ? "" : r.path.substring(dot + 1).toLowerCase();
        const rank = RENDER_EXT_PREFERENCE.indexOf(ext);
        const effectiveRank = rank === -1 ? RENDER_EXT_PREFERENCE.length : rank;
        if (effectiveRank < bestRank) {
            best = r;
            bestRank = effectiveRank;
        }
    }
    return best;
}

// How far into a render to park the thumbnail. A <video> at rest shows frame 0,
// and frame 0 of a DOOH render is routinely the worst frame in the clip -- these
// ads open on a white flash, a black hold or an empty plate, so a grid of them
// was full of blank cards for footage that looks fine a second later. A quarter
// of the way in clears the intro on the 10s and 15s durations the studio ships.
export const POSTER_FRAME_FRACTION = 0.25;

/**
 * Parks a preview <video> on a representative frame instead of frame 0, and
 * tells the caller when a frame worth sampling has decoded.
 *
 * Sequencing matters. `loadedmetadata` is the first point `duration` exists, so
 * the seek is issued there; the frame only actually exists after `seeked`, which
 * is where a colour sample belongs. `loadeddata` is kept purely as the fallback
 * for a clip whose duration never resolves (a stream, or a codec Chromium
 * half-supports) -- in that case no seek is coming and frame 0 is all there is.
 */
export function usePosterFrame(
    videoRef: React.RefObject<HTMLVideoElement | null>,
    onFrameReady: () => void
) {
    const posterTimeRef = useRef(0);
    const seekPendingRef = useRef(false);

    const onLoadedMetadata = () => {
        const v = videoRef.current;
        if (!v) return;
        const d = v.duration;
        // NaN until metadata resolves, Infinity for a stream -- both mean "can't
        // compute an offset", so leave it on frame 0 rather than throwing a bad
        // currentTime at the element.
        if (!isFinite(d) || d <= 0) return;
        posterTimeRef.current = d * POSTER_FRAME_FRACTION;
        seekPendingRef.current = true;
        try {
            v.currentTime = posterTimeRef.current;
        } catch (e) {
            seekPendingRef.current = false;
        }
    };

    const onSeeked = () => {
        seekPendingRef.current = false;
        onFrameReady();
    };

    const onLoadedData = () => {
        if (seekPendingRef.current) return; // the seeked frame is the one to sample
        onFrameReady();
    };

    // Called on mouse-leave: stop, and go back to the poster frame rather than
    // leaving the card sitting on whatever frame the hover stopped on.
    const restToPoster = () => {
        const v = videoRef.current;
        if (!v) return;
        v.pause();
        try {
            v.currentTime = posterTimeRef.current;
        } catch (e) {
            /* nothing to restore to */
        }
    };

    return { onLoadedMetadata, onSeeked, onLoadedData, restToPoster };
}
