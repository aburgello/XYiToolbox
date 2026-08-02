// =============================================================================
// src/js/main/tools/ReviewPlayer.tsx
// -----------------------------------------------------------------------------
// In-panel synced video player for the Review Session: plays the master .mp4
// and the localised .mov side by side, synced, with a live pixel-diff pass.
//
// The three views:
//   MASTER (left)   — the OV master render
//   LOCAL (right)   — the localised render under review
//   DIFF (below)    — a live canvas that composites the pixel difference
//                     between the two at the current frame (white = identical,
//                     coloured = differs), so drift is visible at a glance
//                     without opening the AE comparison comp.
//
// Sync model: the local video is the TIME MASTER.  Both <video> elements
// play()/pause() together and are seeked to the same currentTime on scrub.
// The diff canvas is redrawn on a rAF loop only while either video is
// seeking or playing, and is tainted-safe: if getImageData throws (cross-
// origin/CEF taint), the diff view degrades to a "diff unavailable" note and
// the side-by-side still works.
//
// Clicking the diff view (or the videos) can call an optional onScrub(frame)
// so the AE comparison comp can follow (reviewJumpComp).  The AE comp's
// frameRate may differ from these files', so frame = Math.round(t * fps).
// =============================================================================
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, AlertTriangle } from "lucide-react";
import "./ReviewPlayer.scss";

// Same path→file:// URL logic OVLibrary uses (drive letters, UNC, percent
// encoding).  Kept local so this component has no dependency on OVLibrary.
function toFileUrl(p: string): string {
    if (!p) return "";
    if (p.startsWith("file://")) return p;
    let normalized = p.replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(normalized)) {
        normalized = "/" + normalized;
    } else if (normalized.startsWith("//")) {
        normalized = normalized.substring(2);
    }
    return "file://" + encodeURI(normalized);
}

interface ReviewPlayerProps {
    masterPath: string;       // .mp4
    localPath: string;        // .mov
    compFrameRate: number;    // the AE comparison comp's fps (for scrubbing)
    onScrub?: (frame: number) => void;
}

const ReviewPlayer: React.FC<ReviewPlayerProps> = ({ masterPath, localPath, compFrameRate, onScrub }) => {
    const masterRef = useRef<HTMLVideoElement | null>(null);
    const localRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [diffError, setDiffError] = useState<string | null>(null);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [localLoadError, setLocalLoadError] = useState(false);
    const [masterLoadError, setMasterLoadError] = useState(false);
    const rafRef = useRef<number | null>(null);
    const lastPaint = useRef(0);

    // Redraw the diff canvas from both videos' current frames.  Runs on a
    // rAF loop while playing/seeking; also triggered on a scrub seek.
    const paintDiff = useCallback(() => {
        const m = masterRef.current;
        const l = localRef.current;
        const canvas = canvasRef.current;
        if (!m || !l || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        try {
            // Draw master then local into the SAME offscreen so the diff is
            // the literal composite — but to get a real difference, draw
            // local, then read both via drawImage + getImageData of the two
            // separate canvases.  Simplest robust approach: render each to
            // its own offscreen, then compare pixels.
            const oc = document.createElement("canvas");
            oc.width = w;
            oc.height = h;
            const octx = oc.getContext("2d");
            if (!octx) return;

            octx.drawImage(m, 0, 0, w, h);
            const mData = octx.getImageData(0, 0, w, h).data;

            octx.clearRect(0, 0, w, h);
            octx.drawImage(l, 0, 0, w, h);
            const lData = octx.getImageData(0, 0, w, h).data;

            const out = ctx.createImageData(w, h);
            const d = out.data;
            const md = mData;
            const ld = lData;
            for (let i = 0; i < md.length; i += 4) {
                const dr = Math.abs(md[i] - ld[i]);
                const dg = Math.abs(md[i + 1] - ld[i + 1]);
                const db = Math.abs(md[i + 2] - ld[i + 2]);
                const mag = (dr + dg + db) / 3;
                if (mag < 8) {
                    // Identical-ish → dark.
                    d[i] = 20; d[i + 1] = 22; d[i + 2] = 26; d[i + 3] = 255;
                } else {
                    // Differs → bright magenta/red, intensity by magnitude.
                    d[i] = 255;
                    d[i + 1] = Math.min(60 + mag, 120);
                    d[i + 2] = Math.min(60 + mag, 120);
                    d[i + 3] = 255;
                }
            }
            ctx.putImageData(out, 0, 0);
            setDiffError(null);
        } catch (e) {
            // Tainted canvas (CEF/cross-origin) — degrade to a note.
            setDiffError((prev) => prev ?? "Diff unavailable in this panel — open the comparison comp for a difference pass.");
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(0, 0, w, h);
        }
    }, []);

    // Diff loop while playing.
    useEffect(() => {
        if (!playing) return;
        const tick = (t: number) => {
            if (t - lastPaint.current > 66) { // ~15fps is plenty for a diff
                paintDiff();
                lastPaint.current = t;
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [playing, paintDiff]);

    // Keep the two videos in sync: whichever one fires a timeupdate drives
    // the other to the same time.  The local video is the master.
    const syncFrom = (from: "master" | "local") => {
        const m = masterRef.current;
        const l = localRef.current;
        if (!m || !l) return;
        const src = from === "master" ? m : l;
        const dst = from === "master" ? l : m;
        if (Math.abs(src.currentTime - dst.currentTime) > 0.05) {
            dst.currentTime = src.currentTime;
        }
        setTime(src.currentTime);
        paintDiff();
    };

    const togglePlay = () => {
        const m = masterRef.current;
        const l = localRef.current;
        if (!m || !l) return;
        if (m.paused) {
            m.play();
            l.play();
            setPlaying(true);
        } else {
            m.pause();
            l.pause();
            setPlaying(false);
        }
    };

    const seek = (t: number) => {
        const m = masterRef.current;
        const l = localRef.current;
        if (!m || !l) return;
        m.currentTime = t;
        l.currentTime = t;
        setTime(t);
        paintDiff();
        if (onScrub) onScrub(Math.round(t * compFrameRate));
    };

    const step = (dir: 1 | -1) => {
        const l = localRef.current;
        if (!l) return;
        const f = 1 / 25; // step one 25fps frame; fine for QC
        seek(Math.max(0, Math.min(l.duration || 0, l.currentTime + dir * f)));
    };

    const onLoaded = () => {
        const l = localRef.current;
        if (l && l.duration) setDuration(l.duration);
        setLoaded(true);
        paintDiff();
    };

    const formatTime = (t: number) => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    const fps = compFrameRate > 0 ? compFrameRate : 25;

    return (
        <div className="rv-player">
            <div className="rv-player-track">
                <div className="rv-player-side">
                    <span className="rv-player-tag rv-player-tag--master">MASTER</span>
                    <video
                        ref={masterRef}
                        src={toFileUrl(masterPath)}
                        muted
                        playsInline
                        preload="auto"
                        onLoadedData={onLoaded}
                        onError={() => setMasterLoadError(true)}
                        onTimeUpdate={() => syncFrom("master")}
                        onSeeked={() => syncFrom("master")}
                    />
                </div>
                <div className="rv-player-side">
                    <span className="rv-player-tag rv-player-tag--local">LOCAL</span>
                    <video
                        ref={localRef}
                        src={toFileUrl(localPath)}
                        muted
                        playsInline
                        preload="auto"
                        onLoadedData={onLoaded}
                        onError={() => setLocalLoadError(true)}
                        onTimeUpdate={() => syncFrom("local")}
                        onSeeked={() => syncFrom("local")}
                    />
                </div>
            </div>

            {/* Diff pass */}
            <div className="rv-player-diff">
                <span className="rv-player-tag rv-player-tag--diff">DIFF</span>
                <canvas ref={canvasRef} width={640} height={360} className="rv-player-canvas" />
                {diffError && (
                    <div className="rv-player-diff-note">
                        <AlertTriangle size={11} /> {diffError}
                    </div>
                )}
            </div>

            {/* Transport */}
            <div className="rv-player-controls">
                <button className="rv-player-btn" onClick={() => seek(0)} title="Start">
                    <SkipBack size={13} />
                </button>
                <button className="rv-player-btn" onClick={() => step(-1)} title="Prev frame">
                    <SkipBack size={13} className="rv-rotate-flip" />
                </button>
                <button className="rv-player-btn rv-player-play" onClick={togglePlay} title={playing ? "Pause" : "Play"}>
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button className="rv-player-btn" onClick={() => step(1)} title="Next frame">
                    <SkipForward size={13} />
                </button>
                <span className="rv-player-time">{formatTime(time)} / {formatTime(duration)} · {fps}fps</span>
            </div>

            {(localLoadError || masterLoadError) && (
                <div className="rv-player-err">
                    <AlertTriangle size={11} />
                    {localLoadError && " Couldn't load the local render."}
                    {masterLoadError && " Couldn't load the master render."}
                </div>
            )}
        </div>
    );
};

export default ReviewPlayer;
