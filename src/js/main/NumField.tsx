// =============================================================================
// src/js/main/NumField.tsx
// -----------------------------------------------------------------------------
// A NUMBER FIELD YOU CAN DO SUMS IN, and the parser behind it. Lifted out of
// Bespoke.tsx unchanged when the guided build needed the same fields: two
// copies of a parser drift, and the copy that drifts is the one that turns a
// half-typed `5000/` into 0.
// =============================================================================
import React, { useState } from "react";

/**
 * Arithmetic in a number field: type `5000/3` and get 1667.
 *
 * A HAND-ROLLED PARSER, NOT `eval`. This runs on text somebody typed into a
 * panel that is itself a file:// page with the whole ExtendScript bridge behind
 * it, and `eval` on that input would be the second bare eval in this codebase —
 * CLAUDE.md already lists the first as a known soft spot. Four operators,
 * brackets and a unary sign is the whole grammar anybody wants here, and it is
 * twenty lines.
 *
 * Returns null on anything it cannot read, and the caller LEAVES THE FIELD
 * ALONE when it does — a half-typed `5000/` must not become 5000 or 0 while the
 * cursor is still in it.
 */
export function evalNumeric(src: string): number | null {
    const text = String(src || "").replace(/\s+/g, "");
    if (!text) return null;
    if (!/^[0-9+\-*/().]+$/.test(text)) return null;
    let at = 0;
    const peek = () => text.charAt(at);
    // expr := term (('+'|'-') term)*
    const expr = (): number | null => {
        let left = term();
        if (left === null) return null;
        while (peek() === "+" || peek() === "-") {
            const op = text.charAt(at++);
            const right = term();
            if (right === null) return null;
            left = op === "+" ? left + right : left - right;
        }
        return left;
    };
    // term := unary (('*'|'/') unary)*
    const term = (): number | null => {
        let left = unary();
        if (left === null) return null;
        while (peek() === "*" || peek() === "/") {
            const op = text.charAt(at++);
            const right = unary();
            if (right === null) return null;
            // Division by zero is not an answer, it is a typo mid-edit.
            if (op === "/" && right === 0) return null;
            left = op === "*" ? left * right : left / right;
        }
        return left;
    };
    const unary = (): number | null => {
        if (peek() === "+") { at++; return unary(); }
        if (peek() === "-") { at++; const v = unary(); return v === null ? null : -v; }
        if (peek() === "(") {
            at++;
            const v = expr();
            if (v === null || peek() !== ")") return null;
            at++;
            return v;
        }
        const start = at;
        while (/[0-9.]/.test(peek())) at++;
        if (at === start) return null;
        const n = Number(text.slice(start, at));
        return isFinite(n) ? n : null;
    };
    const value = expr();
    if (value === null || at !== text.length || !isFinite(value)) return null;
    return value;
}

/**
 * A number field you can do sums in.
 *
 * DRAFT STATE IS THE WHOLE POINT. These fields were controlled inputs writing a
 * number on every keystroke, so `5000/3` was unreachable: the `/` made
 * `Number()` NaN, the guard turned that into 0, and the field re-rendered as 0
 * under the cursor. Holding what was typed until Enter or blur is what makes an
 * expression possible at all.
 *
 * Escape reverts, and an unreadable expression is left exactly as typed rather
 * than being replaced by a guess.
 */
export const NumField: React.FC<{
    value: number;
    onCommit: (n: number) => void;
    className?: string;
    title?: string;
    ariaLabel?: string;
    onFocus?: () => void;
}> = ({ value, onCommit, className, title, ariaLabel, onFocus }) => {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft === null) return;
        const n = evalNumeric(draft);
        setDraft(null);
        if (n !== null) onCommit(n);
    };
    return (
        <input
            className={className}
            value={draft === null ? String(value) : draft}
            title={title}
            aria-label={ariaLabel}
            onFocus={onFocus}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); return; }
                if (e.key === "Escape") { e.preventDefault(); setDraft(null); (e.target as HTMLInputElement).blur(); }
            }}
        />
    );
};
