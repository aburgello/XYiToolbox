// =============================================================================
// src/js/main/tools/GsapDemo.tsx
// -----------------------------------------------------------------------------
// GSAP Demo tool — showcases all three GSAP features integrated into the
// toolbox panel:
//
// 1. Smooth progress bars (GSAP-powered fill animation)
// 2. Ripple buttons (GSAP-powered elastic ripple on click)
// 3. Screen transitions (GSAP-powered slide/fade between sections)
//
// This is a standalone demo tool — no AE bridge calls, no evalTS.
// Everything runs client-side so it works in browser preview too.
// =============================================================================
import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import {
    BarChart3,
    ArrowLeftRight,
    Layers,
    Zap,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    Play,
    Pause,
} from "lucide-react";
import { GsapProgressBar } from "../gsap/components/GsapProgressBar";
import { GsapRippleButton } from "../gsap/components/GsapRippleButton";
import { GsapScreenTransition } from "../gsap/components/GsapScreenTransition";
import { GsapScreen } from "../gsap/types";
import "../gsap/components/GsapProgressBar.scss";
import "../gsap/components/GsapRippleButton.scss";
import "../gsap/components/GsapScreenTransition.scss";
import "./GsapDemo.scss";

const COLORS = [
    "#4361ee",  // blue
    "#3a0ca6",  // purple
    "#7209b7",  // violet
    "#f72585",  // pink
    "#4cc9f0",  // cyan
    "#06d6a0",  // green
];

const GsapDemo = () => {
    const [screen, setScreen] = useState<GsapScreen>("progress");
    const [progress, setProgress] = useState(0);
    const [indeterminate, setIndeterminate] = useState(false);
    const [demoRunning, setDemoRunning] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // --- Progress bar demo logic ---
    const startProgressDemo = () => {
        setProgress(0);
        setIndeterminate(false);
        setDemoRunning(true);
        let p = 0;
        intervalRef.current = setInterval(() => {
            p += Math.random() * 12 + 3;
            if (p >= 100) {
                p = 100;
                setProgress(p);
                setDemoRunning(false);
                if (intervalRef.current) clearInterval(intervalRef.current);
            }
            setProgress(p);
        }, 300);
    };

    const stopProgressDemo = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setDemoRunning(false);
    };

    const resetProgress = () => {
        stopProgressDemo();
        setProgress(0);
    };

    // --- Screen transition handler ---
    const goScreen = (s: GsapScreen) => setScreen(s);

    // --- Cleanup ---
    React.useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

    return (
        <div className="gsap-demo">
            {/* Header */}
            <div className="gsap-demo-header">
                <div className="gsap-demo-title-row">
                    <Zap size={20} className="gsap-demo-icon" />
                    <h2>GSAP Demo</h2>
                </div>
                <p className="gsap-demo-subtitle">
                    GSAP animations integrated into the toolbox panel. Click any demo to see it in action.
                </p>
            </div>

            {/* Screen navigation */}
            <div className="gsap-demo-nav">
                <button
                    className={`gsap-demo-nav-btn ${screen === "progress" ? "active" : ""}`}
                    onClick={() => goScreen("progress")}
                >
                    <BarChart3 size={14} /> Progress
                </button>
                <button
                    className={`gsap-demo-nav-btn ${screen === "ripple" ? "active" : ""}`}
                    onClick={() => goScreen("ripple")}
                >
                    <ArrowLeftRight size={14} /> Ripple
                </button>
                <button
                    className={`gsap-demo-nav-btn ${screen === "transition" ? "active" : ""}`}
                    onClick={() => goScreen("transition")}
                >
                    <Layers size={14} /> Transitions
                </button>
            </div>

            {/* Screen content with GSAP transition */}
            <GsapScreenTransition key={screen} direction={screen === "progress" ? "forward" : "backward"}>
                {screen === "progress" && (
                    <div className="gsap-demo-section">
                        <h3>1. Smooth Progress Bars</h3>
                        <p className="gsap-demo-desc">
                            GSAP-powered progress bar with elastic fill animation, auto-complete fade-out, and indeterminate shimmer mode.
                        </p>

                        <div className="gsap-demo-cards">
                            {/* Determinate progress */}
                            <div className="gsap-demo-card">
                                <h4>Determinate</h4>
                                <p className="gsap-demo-card-desc">0 → 100% with elastic easing</p>
                                <GsapProgressBar
                                    progress={progress}
                                    label={demoRunning ? "Running..." : progress >= 100 ? "Complete!" : "Ready"}
                                    color={COLORS[0]}
                                    autoComplete={progress >= 100}
                                    onComplete={resetProgress}
                                />
                                <div className="gsap-demo-btn-row">
                                    <GsapRippleButton
                                        color={COLORS[0]}
                                        onClick={startProgressDemo}
                                        disabled={demoRunning}
                                    >
                                        <Play size={14} /> Start
                                    </GsapRippleButton>
                                    <GsapRippleButton
                                        color={COLORS[4]}
                                        onClick={resetProgress}
                                        disabled={demoRunning}
                                    >
                                        <RefreshCw size={14} /> Reset
                                    </GsapRippleButton>
                                </div>
                            </div>

                            {/* Indeterminate progress */}
                            <div className="gsap-demo-card">
                                <h4>Indeterminate</h4>
                                <p className="gsap-demo-card-desc">Continuous shimmer animation</p>
                                <GsapProgressBar
                                    indeterminate
                                    label={indeterminate ? "Loading..." : "Ready"}
                                    color={COLORS[1]}
                                />
                                <div className="gsap-demo-btn-row">
                                    <GsapRippleButton
                                        color={COLORS[1]}
                                        onClick={() => setIndeterminate(!indeterminate)}
                                    >
                                        {indeterminate ? <Pause size={14} /> : <Play size={14} />}
                                        {indeterminate ? "Stop" : "Start"}
                                    </GsapRippleButton>
                                </div>
                            </div>

                            {/* Auto-complete demo */}
                            <div className="gsap-demo-card">
                                <h4>Auto-Complete</h4>
                                <p className="gsap-demo-card-desc">Fills to 100%, then fades out automatically</p>
                                <GsapProgressBar
                                    progress={progress >= 100 ? 100 : 0}
                                    label={progress >= 100 ? "Fading out..." : "Ready"}
                                    color={COLORS[2]}
                                    autoComplete={progress >= 100}
                                    completeDelay={500}
                                    onComplete={resetProgress}
                                />
                                <div className="gsap-demo-btn-row">
                                    <GsapRippleButton
                                        color={COLORS[2]}
                                        onClick={() => {
                                            let p = 0;
                                            const iv = setInterval(() => {
                                                p += Math.random() * 15 + 5;
                                                if (p >= 100) {
                                                    p = 100;
                                                    clearInterval(iv);
                                                }
                                                setProgress(p);
                                            }, 200);
                                        }}
                                    >
                                        <Play size={14} /> Run
                                    </GsapRippleButton>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {screen === "ripple" && (
                    <div className="gsap-demo-section">
                        <h3>2. Ripple Buttons</h3>
                        <p className="gsap-demo-desc">
                            Elastic ripple effect on click — expands from the click point with GSAP's spring easing for a satisfying bounce.
                        </p>

                        <div className="gsap-demo-cards">
                            <div className="gsap-demo-card">
                                <h4>Default Size</h4>
                                <p className="gsap-demo-card-desc">Standard ripple (100px)</p>
                                <div className="gsap-demo-btn-row">
                                    <GsapRippleButton
                                        color={COLORS[0]}
                                        onClick={() => {}}
                                    >
                                        <CheckCircle2 size={14} /> Click Me
                                    </GsapRippleButton>
                                    <GsapRippleButton
                                        color={COLORS[1]}
                                        onClick={() => {}}
                                    >
                                        <AlertCircle size={14} /> Error
                                    </GsapRippleButton>
                                    <GsapRippleButton
                                        color={COLORS[2]}
                                        onClick={() => {}}
                                    >
                                        <RefreshCw size={14} /> Reset
                                    </GsapRippleButton>
                                </div>
                            </div>

                            <div className="gsap-demo-card">
                                <h4>Large Ripple</h4>
                                <p className="gsap-demo-card-desc">Bigger ripple (150px) for emphasis</p>
                                <div className="gsap-demo-btn-row">
                                    <GsapRippleButton
                                        color={COLORS[3]}
                                        rippleSize={150}
                                        onClick={() => {}}
                                    >
                                        <Zap size={14} /> Big Ripple
                                    </GsapRippleButton>
                                    <GsapRippleButton
                                        color={COLORS[4]}
                                        rippleSize={150}
                                        onClick={() => {}}
                                    >
                                        <ArrowLeftRight size={14} /> Expand
                                    </GsapRippleButton>
                                </div>
                            </div>

                            <div className="gsap-demo-card">
                                <h4>Fast Bounce</h4>
                                <p className="gsap-demo-card-desc">More elastic, faster snap</p>
                                <div className="gsap-demo-btn-row">
                                    <GsapRippleButton
                                        color={COLORS[5]}
                                        bounce={2.2}
                                        duration={0.4}
                                        onClick={() => {}}
                                    >
                                        <Zap size={14} /> Super Elastic
                                    </GsapRippleButton>
                                    <GsapRippleButton
                                        color={COLORS[0]}
                                        bounce={1.2}
                                        duration={0.8}
                                        onClick={() => {}}
                                    >
                                        <Play size={14} /> Gentle Bounce
                                    </GsapRippleButton>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {screen === "transition" && (
                    <div className="gsap-demo-section">
                        <h3>3. Screen Transitions</h3>
                        <p className="gsap-demo-desc">
                            GSAP-powered slide + fade transitions between sections. The incoming screen slides up and fades in, while the outgoing screen slides down and fades out.
                        </p>

                        <div className="gsap-demo-cards">
                            <div className="gsap-demo-card" style={{ gridColumn: "1 / -1" }}>
                                <h4>Forward Transition</h4>
                                <p className="gsap-demo-card-desc">
                                    Navigate between sections to see the GSAP transition in action. The transition direction changes based on the navigation path.
                                </p>
                                <div className="gsap-demo-visual">
                                    <div className="gsap-demo-visual-row">
                                        <div className="gsap-demo-visual-box box-1">
                                            <span>Box 1</span>
                                        </div>
                                        <div className="gsap-demo-visual-box box-2">
                                            <span>Box 2</span>
                                        </div>
                                        <div className="gsap-demo-visual-box box-3">
                                            <span>Box 3</span>
                                        </div>
                                    </div>
                                    <div className="gsap-demo-visual-row">
                                        <div className="gsap-demo-visual-box box-4">
                                            <span>Box 4</span>
                                        </div>
                                        <div className="gsap-demo-visual-box box-5">
                                            <span>Box 5</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Demo: show transition by re-rendering */}
                        <div className="gsap-demo-cta">
                            <p>Go back to <strong>Progress</strong> or <strong>Ripple</strong> to see the transition in action!</p>
                        </div>
                    </div>
                )}
            </GsapScreenTransition>
        </div>
    );
};

export default GsapDemo;
