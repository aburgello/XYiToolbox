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
import { PreFlightHost } from "./PreFlightModal";
import { McItReportHost } from "./McItReportModal";
import { LocGenReportHost } from "./LocGenReportModal";
import { HomeScreen } from "./screens/HomeScreen";
import { CategoryScreen } from "./screens/CategoryScreen";
import { LocaliseScreen } from "./screens/LocaliseScreen";
import { ToolsScreen } from "./screens/ToolsScreen";
import { ToolScreen } from "./screens/ToolScreen";
import CommandPalette from "./CommandPalette";
import { GsapScreenTransition } from "./gsap/components/GsapScreenTransition";
import { useTheme } from "./hooks/useTheme";
import { registerSoftReload } from "./softReload";
import { setNavigator, setHomeNavigator } from "./lib/navigation";
import WorkflowBubble from "./WorkflowBubble";
// ---------------------------------------------------------------------------
// Screen type -- exported so screen components can reference it without a
// circular import (they import Screen, Main imports them).
// ---------------------------------------------------------------------------
export type Screen =
    // `focusAction` singles out one Toolset card once home mounts. Those
    // actions have no registry entry to navigate to (see CLAUDE.md: an
    // input-less action goes in Toolset's ACTIONS), so a workflow step that
    // points at MC It! or Support Swap has to arrive here instead.
    | { type: "home"; focusAction?: string }
    // autoAction here as well as on `tool`: a tool whose real home is a
    // category's bespoke screen (Big Guy Localiser IS the Localise screen's
    // default pane) is opened as a CATEGORY, so a category screen has to be
    // able to carry the button to press once it mounts.
    | { type: "category"; categoryId: string; selectedToolId?: string; autoAction?: string }
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

    // Back unwinds one step; this is the whole way out. A workflow step that
    // sends you to a tool, whose own back goes to the category it came from,
    // is three presses from home -- and following two steps is five.
    const goHome = () => setScreen({ type: "home" });

    // Lets the Ask tool open a panel tool for the artist -- registered here
    // because ToolScreen renders tool components with no props, so a module
    // handle is the same answer localiseHandoff.ts reached for the same
    // reason. Re-registered per screen so `backTo` returns the artist where
    // they actually were, not where they were when the panel first mounted.
    //
    // NAVIGATION ONLY: no autoAction is passed, deliberately -- see the header
    // of lib/agent/navigation.ts for why the agent does not get a generic
    // button-clicker.
    useEffect(() => {
        setNavigator((toolId: string, livesIn?: string, autoAction?: string) => {
            // A tool whose real home is a category's bespoke screen (Big Guy
            // Localiser IS the Localise screen's default pane) is better
            // reached there, in context with its siblings, than on an
            // isolated tool page.
            //
            // `autoAction` has already been gated in navigation.ts -- it only
            // ever arrives here for a button the registry marks "read".
            if (livesIn) setScreen({ type: "category", categoryId: livesIn, autoAction });
            else setScreen({ type: "tool", toolId, backTo: screen, autoAction });
        });
        return () => setNavigator(null);
    }, [screen]);

    // The Toolset grid's own actions, which live on THIS screen rather than on
    // a tool page. Not folded into setNavigator above because the argument is a
    // different kind of thing -- an action id, not a registry tool id -- and one
    // function taking either would have to guess which it had been handed.
    useEffect(() => {
        setHomeNavigator((focusAction: string) => setScreen({ type: "home", focusAction }));
        return () => setHomeNavigator(null);
    }, []);
    // Auto-fires a named button inside a tool's component after it mounts.
    // Used when a search hit matches an inner action (e.g. "Trott 2.0") --
    // navigating to the tool's page AND clicking that button in one step.
    // Watches document.body via MutationObserver since AnimatePresence
    // mode="wait" can delay mounting until the exit animation finishes.
    const handledAutoActionRef = useRef<Screen | null>(null);
    useEffect(() => {
        if (screen.type === "home" || !screen.autoAction) return;
        if (handledAutoActionRef.current === screen) return;
        handledAutoActionRef.current = screen;
        const label = screen.autoAction;

        const tryClick = () => {
            // `.drill-body` only exists on a tool page. A category screen
            // (LocaliseScreen, ToolsScreen) has its own chrome, so fall back
            // to the shell -- otherwise an autoAction aimed at a tool that
            // lives inside one of those screens can never fire.
            const container =
                document.querySelector(".drill-body") ||
                document.querySelector(".app-shell");
            if (!container) return false;
            const match = Array.from(container.querySelectorAll("button")).find(
                (b) =>
                    b.textContent?.trim() === label &&
                    // NEVER reach into the agent's own panel. It is mounted in
                    // the shell, so a broadened search can see it, and a label
                    // collision there would have the agent clicking itself.
                    !b.closest(".agent-bubble-panel")
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
        body = <ToolScreen toolId={screen.toolId} onBack={goBack} onHome={goHome} />;
    } else if (screen.type === "category") {
        const categoryScreen = screen;
        const screenProps = {
            selectedToolId: categoryScreen.selectedToolId,
            onSelectTool: (toolId: string) => setScreen({ ...categoryScreen, selectedToolId: toolId }),
            onBack: goBack,
            onHome: goHome,
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
        body = <HomeScreen onNavigate={setScreen} focusAction={screen.focusAction} />;
    }

    return (
        <div className="app-shell">
            <GsapScreenTransition key={screenKey} direction={transitionDirection}>
                {body}
            </GsapScreenTransition>
            <CommandPalette screen={screen} onNavigate={setScreen} />
            {/* Outside GsapScreenTransition on purpose -- the whole point is
                that it survives screen changes, transcript and all. */}
            <WorkflowBubble />
            <DialogHost />
            <PreFlightHost />
            <McItReportHost />
            <LocGenReportHost />
        </div>
    );
};

// Root wrapper owning the soft-reload remount key (see softReload.ts).
// Bumping it remounts <Main/> and everything beneath, so every hook's
// mount-time app.settings read runs again -- exactly what applying a team
// profile needs, and what a hard window.location.reload() was previously
// (unsafely) used for. Kept as a separate component from Main so useTheme()
// and the screen state inside Main are themselves re-run by the remount.
const AppRoot: React.FC = () => {
    const [remountKey, setRemountKey] = useState(0);
    useEffect(() => {
        registerSoftReload(() => setRemountKey((k) => k + 1));
        return () => registerSoftReload(null);
    }, []);
    return <Main key={remountKey} />;
};

export default AppRoot;
