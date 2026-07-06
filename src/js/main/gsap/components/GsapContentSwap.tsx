// =============================================================================
// src/js/main/gsap/components/GsapContentSwap.tsx
// -----------------------------------------------------------------------------
// GSAP-powered swap transition for switching content WITHIN a screen
// (e.g. picking a different tool on the Localise rail / Tools dock).
// Smaller offset + shorter feel than GsapScreenTransition, which handles
// whole-screen navigation.
//
// NOTE: `key` is intentionally NOT a prop (it's React-reserved and never
// reaches the component — the same bug GsapScreenTransition had). Callers
// key the element (<GsapContentSwap key={selectedId} ...>); the remount is
// what re-runs the enter animation.
//
// useLayoutEffect sets the initial invisible state BEFORE first paint to
// prevent the "render visible then snap down" flash.
// =============================================================================
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

interface Props {
    children: React.ReactNode;
    direction?: "forward" | "backward";
}

export const GsapContentSwap: React.FC<Props> = ({ children, direction = "forward" }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const tweenRef = useRef<gsap.core.Tween | null>(null);
    const [mounted, setMounted] = useState(false);

    // Invisible before first paint.
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const offsetY = direction === "forward" ? 16 : -16;
        containerRef.current.style.opacity = "0";
        containerRef.current.style.transform = `translateY(${offsetY}px)`;
        setMounted(true);
    }, [direction]);

    // Animate in after paint.
    useEffect(() => {
        if (!mounted || !containerRef.current) return;
        const container = containerRef.current;

        if (tweenRef.current) {
            tweenRef.current.kill();
            tweenRef.current = null;
        }

        const offsetY = direction === "forward" ? 16 : -16;
        gsap.set(container, { opacity: 0, y: offsetY });
        tweenRef.current = gsap.to(container, {
            opacity: 1,
            y: 0,
            duration: 0.35,
            ease: "power2.inOut",
        });

        return () => {
            if (tweenRef.current) {
                tweenRef.current.kill();
                tweenRef.current = null;
            }
        };
    }, [direction, mounted]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                willChange: "opacity, transform",
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
            }}
        >
            {children}
        </div>
    );
};

export default GsapContentSwap;
