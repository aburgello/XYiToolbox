// =============================================================================
// src/js/lib/utils/evalTSSafe.ts
// -----------------------------------------------------------------------------
// A thin wrapper around evalTS that adds:
//   1. A configurable timeout (default 15 s) so calls never hang silently
//      when AE is busy rendering or a modal dialog is blocking the bridge.
//   2. A normalised ActionResult shape ({ success, error?, message?, ... })
//      so every call site gets a predictable object back instead of
//      dealing with raw rejections.
//
// Usage (drop-in for evalTS at call sites that show user-visible feedback):
//
//   import { evalTSSafe } from "../../lib/utils/evalTSSafe";
//
//   const result = await evalTSSafe("organiseFolders");
//   // result.success === false + result.error === "AE is busy…" on timeout
//
// For calls that need the raw typed return value (e.g. loadAllToolOrders
// returning a Record) keep using evalTS directly -- this wrapper is
// specifically for user-triggered actions that show toasts/status lines.
// =============================================================================
import { evalTS } from "./bolt";
import type { Scripts } from "@esTypes/index";

type ArgTypes<F extends Function> = F extends (...args: infer A) => any ? A : never;

export interface ActionResult {
    success: boolean;
    error?: string;
    message?: string;
    savedFiles?: string[];
    log?: string;
    [key: string]: unknown;
}

const NO_BRIDGE_MSG = "No CEP bridge detected — open this panel inside After Effects to run it.";
const BUSY_MSG = "After Effects is busy or not responding. Try again in a moment.";

export async function evalTSSafe<
    Key extends string & keyof Scripts,
    Func extends Function & Scripts[Key]
>(
    functionName: Key,
    ...args: ArgTypes<Func>
): Promise<ActionResult> {
    const timeoutMs = 15_000;

    // Definite-assignment assertion (!) is correct here, not a workaround --
    // `new Promise(executor)` invokes its executor synchronously per spec,
    // so timeoutHandle IS assigned before callPromise's IIFE ever runs
    // (this is declared before callPromise below). TS just can't prove
    // that guarantee across the two separate closures.
    let timeoutHandle!: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<ActionResult>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ success: false, error: BUSY_MSG }), timeoutMs);
    });

    const callPromise: Promise<ActionResult> = (async () => {
        try {
            // @ts-ignore -- spreading generic args; evalTS signature handles typing
            const result = await evalTS(functionName, ...args);
            clearTimeout(timeoutHandle);
            if (result === undefined) return { success: false, error: NO_BRIDGE_MSG };
            // If the ExtendScript function returned a plain boolean true,
            // normalise it to a success result.
            if (result === true) return { success: true };
            if (result === false) return { success: false, error: "Script returned false." };
            return result as ActionResult;
        } catch (e: unknown) {
            clearTimeout(timeoutHandle);
            if (e && typeof e === "object" && "message" in e) {
                const msg = (e as { message: string }).message;
                // evalTS rejects with the ExtendScript error object -- surface it cleanly.
                return { success: false, error: msg };
            }
            // Likely "no bridge" (csi not available in browser preview).
            return { success: false, error: NO_BRIDGE_MSG };
        }
    })();

    return Promise.race([callPromise, timeoutPromise]);
}
