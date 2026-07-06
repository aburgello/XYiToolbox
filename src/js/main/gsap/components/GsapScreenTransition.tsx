// =============================================================================
// src/js/main/gsap/components/GsapScreenTransition.tsx
// -----------------------------------------------------------------------------
// GSAP-powered screen transition wrapper.
//
// Replaces the basic Framer Motion screen fade with a GSAP-driven transition
// that slides the incoming screen up while fading it in, and slides the
// outgoing screen down while fading it out.
//
// Usage:
//   <GsapScreenTransition key={screenKey}>
//     {screenContent}
//   </GsapScreenTransition>
//
// IMPORTANT: This component uses useLayoutEffect to set the initial invisible
// state BEFORE the first paint, preventing the "render down then snap" flash.
// =============================================================================
import React, { useRef, useLayoutEffect, useEffect, useState } from "react";
import gsap from "gsap";

// NOTE: `key` is intentionally NOT a prop here. It's a React-reserved prop —
// React consumes it during reconciliation and never passes it into the
// component, so reading it inside would always be undefined. Callers still
// pass `key={screenKey}` on the JSX element (see main.tsx); changing it forces
// a remount, which is what re-runs the enter animation below.
interface Props {
    children: React.ReactNode;
    direction?: "forward" | "backward";
    exit?: boolean;
}

export const GsapScreenTransition: React.FC<Props> = ({
    children,
    direction = "forward",
    exit = false,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const prevAnimRef = useRef<gsap.core.Tween | gsap.core.Timeline | null>(null);
    const [mounted, setMounted] = useState(false);

    // Set initial invisible state BEFORE first paint to prevent flash.
    // useLayoutEffect fires synchronously after DOM mutations but before
    // the browser paints, so the container starts invisible.
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;
        const offsetY = direction === "forward" ? 30 : -30;
        container.style.opacity = "0";
        container.style.transform = `translateY(${offsetY}px)`;
        setMounted(true);
    }, [direction]);

    // Start GSAP animation after paint (useEffect) to let the browser
    // render the initial invisible state first, then animate in.
    useEffect(() => {
        if (!mounted || !containerRef.current) return;

        const container = containerRef.current;

        // Cancel any in-flight animation
        if (prevAnimRef.current) {
            prevAnimRef.current.kill();
            prevAnimRef.current = null;
        }

        if (exit) {
            // Animate out
            prevAnimRef.current = gsap.to(container, {
                opacity: 0,
                y: direction === "forward" ? "-30px" : "30px",
                duration: 0.45,
                ease: "power2.inOut",
                onComplete: () => {
                    container.style.opacity = "0";
                    container.style.transform = "none";
                },
            });
        } else {
            // Ensure we start from the invisible offset position
            // (in case the previous animation left us at 0,0)
            const offsetY = direction === "forward" ? 30 : -30;
            gsap.set(container, {
                opacity: 0,
                y: offsetY,
            });

            // Animate in — small delay lets lazy chunks finish loading
            // from hover-time prefetch before the fade begins, so content
            // is mounted by the time opacity starts rising.
            //
            // Rather than sliding the whole container as a single rigid
            // block (which reads "blocky"), we keep the container's
            // translate/opacity short and add a second tween that staggers
            // the screen's own visual sections — header row, title,
            // master-detail / body / frame — so they cascade in with a
            // slight delay between each. power3.out produces smoother
            // deceleration than power2.inOut for the cascade.
            const children = gsap.utils.toArray<HTMLElement>(
                container.querySelectorAll(
                    ".drill-header-row, h2, .category-master-detail, .drill-body, .ls-frame, .tool-content-header, .tool-content-body"
                )
            );
            gsap.set(children, { opacity: 0, y: 14 });

            const tl = gsap.timeline({ delay: 0.12 });
            tl.set(container, { opacity: 0, y: offsetY });
            tl.to(container, {
                opacity: 1,
                y: 0,
                duration: 0.35,
                ease: "power3.out",
            });
            tl.to(
                children,
                {
                    opacity: 1,
                    y: 0,
                    duration: 0.4,
                    stagger: 0.06,
                    ease: "power3.out",
                },
                0.08
            );
            prevAnimRef.current = tl;
        }

        // Cleanup on unmount
        return () => {
            if (prevAnimRef.current) {
                prevAnimRef.current.kill();
                prevAnimRef.current = null;
            }
        };
    }, [direction, exit, mounted]);

    return (
        <div
            ref={containerRef}
            className="gsap-screen-transition"
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
            }}
        >
            {children}
        </div>
    );
};

export default GsapScreenTransition;
