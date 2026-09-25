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

/**
 * What a dialog SAYS, in the shape the rest of the panel speaks: a short
 * title that is the question, an optional line or two under it, and a button
 * named for what it does ("Scan", "Remove", "Delete for everyone") rather than
 * "OK". A plain string still works -- its first paragraph becomes the title
 * when short enough to be one -- so no call site has to change to benefit.
 */
export interface DialogCopy {
    title: string;
    body?: string;
    /** The primary button. Defaults to "OK" for an alert, "Continue" otherwise. */
    confirm?: string;
    cancel?: string;
    /** Destructive: the primary button turns red. */
    danger?: boolean;
}

type DialogText = string | DialogCopy;

interface Shown {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    danger: boolean;
    /** The category tint of wherever the dialog was opened from. */
    tint: string;
}

type DialogRequest =
    | { kind: "alert"; shown: Shown; resolve: () => void }
    | { kind: "confirm"; shown: Shown; resolve: (value: boolean) => void }
    | { kind: "prompt"; shown: Shown; defaultValue: string; resolve: (value: string | null) => void }
    | { kind: "select"; shown: Shown; options: string[]; defaultIndex: number; resolve: (value: number | null) => void };

let pushRequest: ((req: DialogRequest) => void) | null = null;

/** The --cat-grad in force where the dialog was opened (custom properties
 *  inherit, so the focused element carries its category's), else "". The
 *  host is mounted at the shell root, outside every tinted wrapper. */
// The element under the last mouse press. Focus alone is not enough: macOS
// does not focus a button on click, so activeElement is often <body> -- and
// the dialog lost its colour. Captured, so no handler can hide it.
let lastPressed: HTMLElement | null = null;
if (typeof document !== "undefined") {
    document.addEventListener("mousedown", (e) => { lastPressed = e.target as HTMLElement; }, true);
}

function openerTint(): string {
    try {
        const focused = document.activeElement as HTMLElement | null;
        const el = (lastPressed && document.contains(lastPressed) ? lastPressed : null)
            || (focused && focused !== document.body ? focused : null)
            || document.body;
        return getComputedStyle(el).getPropertyValue("--cat-grad").trim();
    } catch {
        return "";
    }
}

function toShown(text: DialogText, kind: DialogRequest["kind"]): Shown {
    const fallbackConfirm = kind === "confirm" ? "Continue" : "OK";
    if (typeof text !== "string") {
        return {
            title: text.title,
            body: text.body || "",
            confirm: text.confirm || fallbackConfirm,
            cancel: text.cancel || "Cancel",
            danger: !!text.danger,
            tint: openerTint(),
        };
    }
    // A plain string: a short first paragraph reads as the title, the rest
    // as the body. A long one stays body only, rather than a shouting title.
    const paras = String(text).split(/\n\s*\n/);
    const first = paras[0].trim();
    const titleable = first.length <= 90;
    return {
        title: titleable ? first : "",
        body: titleable ? paras.slice(1).join("\n\n").trim() : String(text),
        confirm: fallbackConfirm,
        cancel: "Cancel",
        danger: false,
        tint: openerTint(),
    };
}

export function alertDialog(message: DialogText): Promise<void> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "alert", shown: toShown(message, "alert"), resolve });
    });
}

export function confirmDialog(message: DialogText): Promise<boolean> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "confirm", shown: toShown(message, "confirm"), resolve });
    });
}

export function promptDialog(message: DialogText, defaultValue = ""): Promise<string | null> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "prompt", shown: toShown(message, "prompt"), defaultValue, resolve });
    });
}

/** Resolves to the chosen option's index, or null if cancelled. For a
 *  one-click Toolset action that needs the user to pick one of a fixed
 *  set of options before running (e.g. a label color) -- same
 *  call-and-await contract as the other three, added for Toggle By Label/
 *  Comp Duration rather than repurposing promptDialog's free-text input,
 *  which would let a typo silently pick nothing. */
export function selectDialog(message: DialogText, options: string[], defaultIndex = 0): Promise<number | null> {
    return new Promise((resolve) => {
        pushRequest?.({ kind: "select", shown: toShown(message, "select"), options, defaultIndex, resolve });
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
                    className={"dialog-card" + (request.shown.danger ? " is-danger" : "")}
                    style={request.shown.tint ? ({ ["--dlg-grad" as any]: request.shown.tint } as React.CSSProperties) : undefined}
                    initial={{ opacity: 0, scale: 0.95, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {request.shown.title && <h3 className="dialog-title">{request.shown.title}</h3>}
                    {request.shown.body && <p className="dialog-message">{request.shown.body}</p>}

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
                                {request.shown.confirm}
                            </button>
                        ) : (
                            <>
                                <button className="dialog-btn-secondary" onClick={cancel}>
                                    {request.shown.cancel}
                                </button>
                                <button className="dialog-btn-primary" onClick={confirmOrSubmit} autoFocus={request.kind === "confirm" && !request.shown.danger}>
                                    {request.shown.confirm}
                                </button>
                            </>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
