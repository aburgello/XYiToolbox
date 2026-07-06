// =============================================================================
// src/js/main/Dialog.tsx
// -----------------------------------------------------------------------------
// Replaces window.alert()/confirm()/prompt() with in-panel React modals.
// The native versions work fine functionally, but their title bar always
// shows the calling page's own origin -- for a CEP panel, that's the raw
// file:// path to index.html inside the extension's install folder, which
// reads as a broken/scary error to anyone not expecting it. That's inherent
// browser/CEF chrome for native dialogs and can't be suppressed from CSS or
// JS; the only fix is not using the native dialog at all.
//
// Same call-and-await shape as the native versions (`await confirmDialog(...)`
// returns a boolean, `await promptDialog(...)` returns string | null, `await
// alertDialog(...)` resolves once dismissed) so call sites barely change --
// swap `window.confirm(...)` for `await confirmDialog(...)`, same for the
// other two. See CLAUDE.md for the full list of files this replaced.
//
// Implementation: a module-level "current request" pointer + a single
// <DialogHost /> mounted once at the app root (main.tsx's app-shell), the
// same singleton-via-module-scope pattern Tooltip.tsx's activeTooltip uses.
// Only one dialog can ever be open at a time, which matches how the native
// versions behaved too (they're all blocking/modal by nature).
// =============================================================================
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import "./Dialog.scss";

type DialogRequest =
    | { kind: "alert"; message: string; resolve: () => void }
    | { kind: "confirm"; message: string; resolve: (value: boolean) => void }
    | { kind: "prompt"; message: string; defaultValue: string; resolve: (value: string | null) => void }
    | { kind: "select"; message: string; options: string[]; defaultIndex: number; resolve: (value: number | null) => void };

let pushRequest: ((req: DialogRequest) => void) | null = null;

export function alertDialog(message: string): Promise<void> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "alert", message, resolve });
    });
}

export function confirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "confirm", message, resolve });
    });
}

export function promptDialog(message: string, defaultValue = ""): Promise<string | null> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "prompt", message, defaultValue, resolve });
    });
}

/** Resolves to the chosen option's index, or null if cancelled. For a
 *  one-click Toolset action that needs the user to pick one of a fixed
 *  set of options before running (e.g. a label color) -- same
 *  call-and-await contract as the other three, added for Toggle By Label/
 *  Comp Duration rather than repurposing promptDialog's free-text input,
 *  which would let a typo silently pick nothing. */
export function selectDialog(message: string, options: string[], defaultIndex = 0): Promise<number | null> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "select", message, options, defaultIndex, resolve });
    });
}

export const DialogHost = () => {
    const [request, setRequest] = useState<DialogRequest | null>(null);
    const [inputValue, setInputValue] = useState("");
    const [selectIndex, setSelectIndex] = useState(0);

    useEffect(() => {
        pushRequest = (req) => {
            setRequest(req);
            if (req.kind === "prompt") setInputValue(req.defaultValue);
            if (req.kind === "select") setSelectIndex(req.defaultIndex);
        };
        return () => {
            pushRequest = null;
        };
    }, []);

    useEffect(() => {
        if (!request) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") cancel();
            // Enter submits, except inside the prompt's own textarea-like use
            // isn't a concern here since it's a single-line input -- Enter
            // there should still submit, matching native prompt() behavior.
            if (e.key === "Enter" && request.kind !== "alert") confirmOrSubmit();
            if (e.key === "Enter" && request.kind === "alert") dismiss();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request, inputValue, selectIndex]);

    if (!request) return null;

    const dismiss = () => {
        if (request.kind === "alert") request.resolve();
        setRequest(null);
    };
    const cancel = () => {
        if (request.kind === "confirm") request.resolve(false);
        else if (request.kind === "prompt") request.resolve(null);
        else if (request.kind === "select") request.resolve(null);
        else request.resolve();
        setRequest(null);
    };
    const confirmOrSubmit = () => {
        if (request.kind === "confirm") request.resolve(true);
        else if (request.kind === "prompt") request.resolve(inputValue);
        else if (request.kind === "select") request.resolve(selectIndex);
        else request.resolve();
        setRequest(null);
    };

    return (
        <AnimatePresence>
            <motion.div
                className="dialog-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={cancel}
            >
                <motion.div
                    className="dialog-card"
                    initial={{ opacity: 0, scale: 0.95, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <p className="dialog-message">{request.message}</p>

                    {request.kind === "prompt" && (
                        <input
                            type="text"
                            className="dialog-input"
                            autoFocus
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                        />
                    )}

                    {request.kind === "select" && (
                        <select
                            className="dialog-input"
                            autoFocus
                            value={selectIndex}
                            onChange={(e) => setSelectIndex(Number(e.target.value))}
                        >
                            {request.options.map((opt, i) => (
                                <option key={i} value={i}>
                                    {opt}
                                </option>
                            ))}
                        </select>
                    )}

                    <div className="dialog-buttons">
                        {request.kind === "alert" ? (
                            <button className="dialog-btn-primary" onClick={dismiss} autoFocus>
                                OK
                            </button>
                        ) : (
                            <>
                                <button className="dialog-btn-secondary" onClick={cancel}>
                                    Cancel
                                </button>
                                <button className="dialog-btn-primary" onClick={confirmOrSubmit}>
                                    OK
                                </button>
                            </>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
