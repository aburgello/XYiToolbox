// =============================================================================
// src/js/main/gsap/components/GsapRippleButton.tsx
// -----------------------------------------------------------------------------
// GSAP-powered ripple button component.
//
// Adds a satisfying ripple effect on click that expands from the click point
// using GSAP's elastic easing. Replaces the basic CSS-only ripple with
// a spring-like bounce that feels more "alive."
//
// Usage:
//   <GsapRippleButton onClick={...} color="#a78bfa" size={20}>
//     Click me
//   </GsapRippleButton>
// =============================================================================
import React, { useRef, useCallback, useState } from "react";
import gsap from "gsap";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    color?: string;
    rippleSize?: number;
    duration?: number;
    bounce?: number;
    opacity?: number;
    className?: string;
}

export const GsapRippleButton: React.FC<Props> = ({
    children,
    color = "#4361ee",
    rippleSize = 80,
    duration = 0.8,
    bounce = 2.5,
    opacity = 0.4,
    className = "",
    onClick,
    style,
    ...rest
}) => {
    const btnRef = useRef<HTMLButtonElement>(null);
    const rippleRef = useRef<HTMLSpanElement>(null);
    const [rippleVisible, setRippleVisible] = useState(false);
    const animRef = useRef<gsap.core.Tween | null>(null);

    const handleClick = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            // Run the user's onClick
            onClick?.(e);

            // Get click position relative to button
            const rect = btnRef.current?.getBoundingClientRect();
            if (!rect) return;

            const x = e.clientX - rect.left - rippleSize / 2;
            const y = e.clientY - rect.top - rippleSize / 2;

            // Create ripple element
            setRippleVisible(true);

            // Defer to next frame so React has rendered the ripple before we
            // read the ref — setRippleVisible is async so the element won't
            // exist on this tick.
            requestAnimationFrame(() => {
                const ripple = rippleRef.current;
                if (!ripple) return;

                // Reset ripple state
                ripple.style.left = `${x}px`;
                ripple.style.top = `${y}px`;
                ripple.style.opacity = "1";
                ripple.style.transform = "scale(0)";

                // Animate with GSAP spring
                if (animRef.current) animRef.current.kill();
                animRef.current = gsap.to(ripple, {
                    scale: rippleSize / 50, // scale up to rippleSize (base is 50px)
                    opacity: 0,
                    duration,
                    ease: `back.out(${bounce})`,
                    onComplete: () => {
                        setRippleVisible(false);
                        animRef.current = null;
                    },
                });
            });
        },
        [onClick, rippleSize, duration, bounce]
    );

    return (
        <button
            ref={btnRef}
            className={`gsap-ripple-btn ${className}`}
            onClick={handleClick}
            style={style}
            {...rest}
        >
            {children}
            {rippleVisible && (
                <span
                    ref={rippleRef}
                    className="gsap-ripple"
                    style={{ backgroundColor: color, opacity }}
                />
            )}
        </button>
    );
};

export default GsapRippleButton;
