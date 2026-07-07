// =============================================================================
// src/js/main/main.tsx
// -----------------------------------------------------------------------------
// XYi Toolbox shell -- thin coordinator.
//
// Owns only:
//   - Screen state (which screen is showing, back-stack)
//   - autoAction firing (search hit → auto-click a button once its tool mounts)
//   - GSAP-powered screen transitions (GsapScreenTransition)
//   - The singleton DialogHost
//   - Mounting CommandPalette (global Ctrl/Cmd+K quick-open, reuses this
//     same screen state so it can navigate/go-back from anywhere, not just
//     HomeScreen's own search)
//
// Everything else has moved:
//   - Tool registry (TOOLS, CATEGORIES, colors)  → toolRegistry.tsx
//   - Favorites state + logic                    → hooks/useFavorites.ts
//   - Tool order state + logic                   → hooks/useToolOrder.ts
//   - Home screen UI                             → screens/HomeScreen.tsx
//   - Category master-detail UI                  → screens/CategoryScreen.tsx
//   - Tool drill-down UI                         → screens/ToolScreen.tsx
//   - Shared animation variants                  → animations.ts
//   - ErrorBoundary for tool components          → ToolErrorBoundary.tsx
//   - evalTS timeout wrapper                     → lib/utils/evalTSSafe.ts
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import "gsap";
import "./main.scss";
import { DialogHost } from "./Dialog";
import { HomeScreen } from "./screens/HomeScreen";
import { CategoryScreen } from "./screens/CategoryScreen";
import { LocaliseScreen } from "./screens/LocaliseScreen";
import { ToolsScreen } from "./screens/ToolsScreen";
import { ToolScreen } from "./screens/ToolScreen";
import CommandPalette from "./CommandPalette";
import { GsapScreenTransition } from "./gsap/components/GsapScreenTransition";
import { useTheme } from "./hooks/useTheme";
// ---------------------------------------------------------------------------
// Screen type -- exported so screen components can reference it without a
// circular import (they import Screen, Main imports them).
// ---------------------------------------------------------------------------
export type Screen =
    | { type: "home" }
    | { type: "category"; categoryId: string; selectedToolId?: string }
    | { type: "tool"; toolId: string; backTo: Screen; autoAction?: string };

const Main = () => {
    // Applies the hidden theme picker's saved choice (if any) to the
    // document root on cold start -- mounted here, not just inside
    // HomeScreen's own picker UI, so it isn't tied to Home happening to be
    // the current initial screen.
    useTheme();

    const [screen, setScreen] = useState<Screen>({ type: "home" });

    // Track previous screen type to determine transition direction
    const prevScreenRef = useRef<Screen | null>(null);
    const [transitionDirection, setTransitionDirection] = useState<"forward" | "backward">("forward");

    useEffect(() => {
        if (prevScreenRef.current) {
            const prev = prevScreenRef.current;
            const curr = screen;
            // Determine direction: going deeper (home → category → tool) is forward,
            // going back is backward
            if (prev.type === "home" && curr.type !== "home") {
                setTransitionDirection("forward");
            } else if (prev.type !== "home" && curr.type === "home") {
                setTransitionDirection("backward");
            } else if (prev.type === "category" && curr.type === "tool") {
                setTransitionDirection("forward");
            } else if (prev.type === "tool" && curr.type === "category") {
                setTransitionDirection("backward");
            }
        }
        prevScreenRef.current = screen;
    }, [screen]);

    const goBack = () => {
        if (screen.type === "tool") setScreen(screen.backTo);
        else setScreen({ type: "home" });
    };
    // Auto-fires a named button inside a tool's component after it mounts.
    // Used when a search hit matches an inner action (e.g. "Trott 2.0") --
    // navigating to the tool's page AND clicking that button in one step.
    // Watches document.body via MutationObserver since AnimatePresence
    // mode="wait" can delay mounting until the exit animation finishes.
    const handledAutoActionRef = useRef<Screen | null>(null);
    useEffect(() => {
        if (screen.type !== "tool" || !screen.autoAction) return;
        if (handledAutoActionRef.current === screen) return;
        handledAutoActionRef.current = screen;
        const label = screen.autoAction;

        const tryClick = () => {
            const container = document.querySelector(".drill-body");
            if (!container) return false;
            const match = Array.from(container.querySelectorAll("button")).find(
                (b) => b.textContent?.trim() === label
            );
            if (match) { match.click(); return true; }
            return false;
        };

        if (tryClick()) return;

        const observer = new MutationObserver(() => { if (tryClick()) observer.disconnect(); });
        observer.observe(document.body, { childList: true, subtree: true });
        const timeout = setTimeout(() => observer.disconnect(), 5000);
        return () => { observer.disconnect(); clearTimeout(timeout); };
    }, [screen]);

    // Derive a stable key for screen transitions.
    const screenKey =
        screen.type === "tool"     ? `tool:${screen.toolId}` :
        screen.type === "category" ? `category:${screen.categoryId}` :
        "home";

    let body: React.ReactNode;
    if (screen.type === "tool") {
        body = <ToolScreen toolId={screen.toolId} onBack={goBack} />;
    } else if (screen.type === "category") {
        const categoryScreen = screen;
        const screenProps = {
            selectedToolId: categoryScreen.selectedToolId,
            onSelectTool: (toolId: string) => setScreen({ ...categoryScreen, selectedToolId: toolId }),
            onBack: goBack,
        };
        // Localise and Tools get bespoke screens (pipeline rail / workbench
        // dock), same per-category-special-case move as Review/Deliver's hub
        // tools -- CategoryScreen stays as the generic fallback for any
        // category without its own design.
        if (categoryScreen.categoryId === "localise") {
            body = <LocaliseScreen {...screenProps} />;
        } else if (categoryScreen.categoryId === "tools") {
            body = <ToolsScreen {...screenProps} />;
        } else {
            body = <CategoryScreen categoryId={categoryScreen.categoryId} {...screenProps} />;
        }
    } else {
        body = <HomeScreen onNavigate={setScreen} />;
    }

    return (
        <div className="app-shell">
            <GsapScreenTransition key={screenKey} direction={transitionDirection}>
                {body}
            </GsapScreenTransition>
            <CommandPalette screen={screen} onNavigate={setScreen} />
            <DialogHost />
        </div>
    );
};

export default Main;
