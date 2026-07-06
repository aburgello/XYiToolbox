// =============================================================================
// src/js/main/gsap/components/GsapProgressBar.tsx
// -----------------------------------------------------------------------------
// GSAP-powered progress bar for loading states.
//
// Replaces the static .spin spinner with an animated progress bar that
// gives the user a visual sense of forward motion during long operations.
//
// Features:
//   - Smooth fill animation (0 → target%)
//   - Smooth shrink-back when done (target% → 0%)
//   - Color matches the panel's accent (category color or default)
//   - Auto-completes and fades out after a configurable delay
//
// Usage:
//   <GsapProgressBar progress={65} label="Scanning..." color="#a78bfa" />
//   <GsapProgressBar progress={-1} indeterminate label="Loading..." />
// =============================================================================
import React, { useRef, useEffect, useState, useCallback } from "react";
import gsap from "gsap";

interface Props {
    progress?: number; // 0-100, or -1 for indeterminate
    indeterminate?: boolean;
    label?: string;
    color?: string;
    height?: number;
    onComplete?: () => void;
    autoComplete?: boolean;
    completeDelay?: number;
}

export const GsapProgressBar: React.FC<Props> = ({
    progress = 0,
    indeterminate = false,
    label,
    color = "#4361ee",
    height = 4,
    onComplete,
    autoComplete = true,
    completeDelay = 800,
}) => {
    const barRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(true);
    const [animProgress, setAnimProgress] = useState(0);
    const prevProgressRef = useRef(progress);
    const animRef = useRef<gsap.core.Tween | null>(null);

    // Animate the bar from prevProgress to new progress
    useEffect(() => {
        if (!barRef.current) return;

        // Cancel any in-flight animation
        if (animRef.current) {
            animRef.current.kill();
        }

        const fromVal = prevProgressRef.current;
        prevProgressRef.current = progress;

        // Indeterminate mode: skip animation, just show the shimmer
        if (indeterminate) {
            setAnimProgress(0);
            return;
        }

        // Clamp progress
        const clamped = Math.max(0, Math.min(100, progress));
        setAnimProgress(clamped);

        // Animate width
        animRef.current = gsap.to(barRef.current, {
            width: `${clamped}%`,
            duration: 0.5,
            ease: "power2.inOut",
            onComplete: () => {
                prevProgressRef.current = clamped;
                animRef.current = null;
            },
        });
    }, [progress, indeterminate]);

    // Auto-complete: animate to 100%, then fade out
    useEffect(() => {
        if (!autoComplete || progress !== 100 || indeterminate) return;

        const timer = setTimeout(() => {
            if (!barRef.current) return;
            // Animate to full width first (just in case)
            gsap.to(barRef.current, {
                width: "100%",
                duration: 0.3,
                ease: "power2.out",
                onComplete: () => {
                    // Then fade out
                    if (trackRef.current) {
                        gsap.to(trackRef.current, {
                            opacity: 0,
                            duration: 0.3,
                            ease: "power2.in",
                            onComplete: () => {
                                setVisible(false);
                                onComplete?.();
                            },
                        });
                    }
                },
            });
        }, completeDelay);

        return () => clearTimeout(timer);
    }, [progress, autoComplete, indeterminate, completeDelay, onComplete]);

    if (!visible) return null;

    return (
        <div
            className="gsap-progress-container"
            style={{
                opacity: visible ? 1 : 0,
                transition: "opacity 0.3s ease",
            }}
        >
            {label && <span className="gsap-progress-label">{label}</span>}
            <div
                className="gsap-progress-track"
                ref={trackRef}
                style={{ height }}
            >
                <div
                    className="gsap-progress-bar"
                    ref={barRef}
                    style={{
                        width: `${animProgress}%`,
                        backgroundColor: color,
                        borderRadius: height > 4 ? height / 2 : height / 2,
                    }}
                />
                {indeterminate && (
                    <div
                        className="gsap-progress-shimmer"
                        style={{
                            backgroundColor: color,
                            borderRadius: height > 4 ? height / 2 : height / 2,
                        }}
                    />
                )}
            </div>
        </div>
    );
};

export default GsapProgressBar;
