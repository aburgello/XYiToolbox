import { useState } from "react";

const cache = new Map<string, unknown>();

export function usePersistentState<T>(key: string, initial: T) {
    const [state, setState] = useState<T>(() => {
        if (cache.has(key)) return cache.get(key) as T;
        return initial;
    });
    const setAndCache = (next: T | ((prev: T) => T)) => {
        setState((prev) => {
            const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
            cache.set(key, resolved);
            return resolved;
        });
    };
    return [state, setAndCache] as const;
}
