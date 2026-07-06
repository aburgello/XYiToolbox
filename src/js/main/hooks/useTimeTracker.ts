// =============================================================================
// src/js/main/hooks/useTimeTracker.ts
// -----------------------------------------------------------------------------
// Module-level singleton store for Timesheet Tracker's Batch mode -- NOT a
// per-component hook with its own state. This is what lets the HomeScreen's
// quick-launch Droplet and the full Tools > Timesheet Tracker page show and
// control the exact same running batch, and what lets tracking keep running
// in the background while the user is on a completely different screen
// (the interval below is owned by this module, not by whichever component
// happens to be mounted -- navigating away in this single-page app doesn't
// unmount the JS module, only the component reading from it).
//
// Time bookkeeping is wall-clock based (elapsedSeconds is a committed total,
// runningSince is unused by design -- see commitElapsed): every ~4s tick we
// ask AE which project is open and commit the elapsed delta to whichever
// file was open during that interval. If neither the home widget nor the
// tool page is mounted the interval still fires in the background (as long
// as this module stays loaded, which it does once anything imports it), so
// a batch can be left running while working elsewhere in the panel.
//
// Persisted via the same app.settings-backed loadTimesheetBatches/
// saveTimesheetBatches pair every mutation makes, so a batch survives
// closing the panel and restarting AE.
// =============================================================================
import { useEffect, useState } from "react";
import { evalTS } from "../../lib/utils/bolt";

export interface BatchFile {
    path: string;      // full fsName -- stable per-file key
    name: string;       // filename with extension
    jobString: string;  // auto-detected job for this file
    seconds: number;    // accumulated (committed) seconds
}

export interface Batch {
    id: string;
    name: string;
    territoryName: string;   // auto-detected -- never hand-picked from a list
    territoryCode: string | null;
    categoryName: string;
    files: BatchFile[];
    createdAt: number;
    elapsedSeconds: number;  // committed batch-wide total (headline clock)
}

// How often (in 1s display ticks) we actually round-trip to AE to detect the
// open file + commit elapsed time. Keeps bridge chatter low; the resulting
// attribution error is bounded by this interval.
const DETECT_EVERY_TICKS = 4;

// Category list is filtered to "Digital - …" entries everywhere this app
// shows it -- this studio's AE work is never logged under the print/admin/
// HR categories TS_CATEGORIES also contains (~47 total), so showing all of
// them was pure noise. Centralized here (not duplicated per-component) so
// TimesheetTracker.tsx's full page and HomeScreen's quick-launch widget
// can never disagree on what counts as "Digital". Browser-preview fallback
// only -- inside AE the real list comes from aeft.ts's TS_CATEGORIES.
const FALLBACK_DIGITAL_CATEGORIES = ["Digital - Build/Production", "Digital - Conceptualising", "Digital - Creating Masters", "Digital - Rendering", "Digital - Production/Localisation"];

export function digitalCategories(raw: string[]): string[] {
    const list = raw.length ? raw.filter((c) => c.toLowerCase().startsWith("digital")) : FALLBACK_DIGITAL_CATEGORIES;
    return list;
}

export function defaultCategoryFor(list: string[]): string {
    return list.find((c) => c.toLowerCase().includes("production/localisation")) || list[0] || "";
}

interface StoreState {
    batches: Batch[];
    activeBatchId: string | null;
    running: boolean;
    activePath: string | null;
    loaded: boolean;
    territories: string[];
    categories: string[]; // raw, unfiltered -- used to match a detected string
}

let state: StoreState = {
    batches: [],
    activeBatchId: null,
    running: false,
    activePath: null,
    loaded: false,
    territories: [],
    categories: [],
};

const listeners = new Set<() => void>();
function notify() { listeners.forEach((l) => l()); }
function patch(next: Partial<StoreState>) { state = { ...state, ...next }; notify(); }

let lastCommitAt = 0;
let tickCount = 0;
let detecting = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function persistBatches() {
    // Fire-and-forget; a failed save just means this change isn't on disk
    // yet (still live in the in-memory store) -- not worth surfacing.
    evalTS("saveTimesheetBatches" as any, JSON.stringify(state.batches)).catch(() => {});
}

let loadStarted = false;
function loadOnce() {
    if (loadStarted) return;
    loadStarted = true;
    (async () => {
        try {
            const raw = await evalTS("loadTimesheetBatches" as any);
            const parsed = raw && typeof raw === "string" ? JSON.parse(raw) : null;
            patch({ batches: Array.isArray(parsed) ? parsed : [], loaded: true });
        } catch {
            patch({ loaded: true });
        }
        try {
            const lists = await evalTS("timesheetGetLists");
            if (lists && lists.success) patch({ territories: lists.territories, categories: lists.categories });
        } catch {
            // browser preview -- lists stay empty, components fall back
        }
    })();
}

function commitElapsed(now: number) {
    const delta = (now - lastCommitAt) / 1000;
    lastCommitAt = now;
    if (delta <= 0 || !state.activeBatchId) return;
    const active = state.activePath;
    const batches = state.batches.map((b) => {
        if (b.id !== state.activeBatchId) return b;
        const files = active ? b.files.map((f) => (f.path === active ? { ...f, seconds: f.seconds + delta } : f)) : b.files;
        return { ...b, elapsedSeconds: b.elapsedSeconds + delta, files };
    });
    patch({ batches });
    persistBatches();
}

// Auto-fills territory (name + 2-letter code for a flag) the first time it's
// detected for the active batch -- never overwritten automatically again
// once set, so a later re-detect (user-triggered, see refreshTerritory) is
// the only thing that can change it after the fact.
async function maybeAutoFillTerritory(territory: string | null) {
    if (!territory || !state.activeBatchId) return;
    const b = state.batches.find((x) => x.id === state.activeBatchId);
    if (!b || b.territoryName) return;
    let code: string | null = null;
    try { code = await evalTS("getTerritoryCountryCode", territory); } catch { /* decorative */ }
    const batches = state.batches.map((x) => (x.id !== state.activeBatchId ? x : { ...x, territoryName: territory, territoryCode: code }));
    patch({ batches });
    persistBatches();
}

async function detectTick() {
    if (detecting) return;
    detecting = true;
    try {
        const info = await evalTS("timesheetActiveFile" as any);
        commitElapsed(Date.now()); // attribute the interval just elapsed to the PREVIOUS active file
        const newPath = info && info.hasFile ? info.path : null;
        if (newPath) {
            if (newPath !== state.activePath && state.activeBatchId) {
                const b = state.activeBatchId;
                const batches = state.batches.map((x) =>
                    x.id !== b || x.files.some((f) => f.path === newPath)
                        ? x
                        : { ...x, files: [...x.files, { path: newPath, name: info.name || newPath, jobString: info.jobString || "", seconds: 0 }] }
                );
                patch({ batches, activePath: newPath });
                persistBatches();
            }
            await maybeAutoFillTerritory(info.territory);
        }
        // else: no saved project open -- carry forward the current file
        // (time keeps landing on whatever was last active).
    } catch {
        // bridge hiccup / no bridge -- the headline clock already advances
        // via the 1s notify() below regardless; detection just skips.
    } finally {
        detecting = false;
    }
}

function ensurePolling() {
    if (pollInterval) return;
    pollInterval = setInterval(() => {
        tickCount++;
        if (tickCount % DETECT_EVERY_TICKS === 0) detectTick();
        notify(); // re-render subscribers every second for the live timer
    }, 1000);
}
function stopPollingIfIdle() {
    if (!state.running && pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// --- Actions -----------------------------------------------------------

export async function createBatch(name: string, categoryName: string): Promise<string> {
    const id = "b" + Date.now();
    const batch: Batch = {
        id, name, territoryName: "", territoryCode: null, categoryName,
        files: [], createdAt: Date.now(), elapsedSeconds: 0,
    };
    const batches = [...state.batches, batch];
    patch({ batches, activeBatchId: id });
    persistBatches();
    return id;
}

export function openBatch(id: string) {
    if (state.running) pauseTracking();
    patch({ activeBatchId: id, activePath: null });
}

export function backToList() {
    if (state.running) pauseTracking();
    patch({ activeBatchId: null });
}

export function removeBatch(id: string) {
    if (state.activeBatchId === id && state.running) pauseTracking();
    const batches = state.batches.filter((b) => b.id !== id);
    patch({ batches, activeBatchId: state.activeBatchId === id ? null : state.activeBatchId });
    persistBatches();
}

export function removeFile(path: string) {
    const batches = state.batches.map((b) => (b.id !== state.activeBatchId ? b : { ...b, files: b.files.filter((f) => f.path !== path) }));
    patch({ batches });
    persistBatches();
}

export function setFileSeconds(path: string, seconds: number) {
    const batches = state.batches.map((b) =>
        b.id !== state.activeBatchId ? b : { ...b, files: b.files.map((f) => (f.path === path ? { ...f, seconds } : f)) }
    );
    patch({ batches });
    persistBatches();
}

export function setCategory(categoryName: string) {
    const batches = state.batches.map((b) => (b.id !== state.activeBatchId ? b : { ...b, categoryName }));
    patch({ batches });
    persistBatches();
}

// User-triggered re-detect (e.g. the batch was started before any file was
// open, so nothing auto-filled yet, or the wrong project's folder matched).
// Overwrites unconditionally, unlike the automatic first-fill.
export async function refreshTerritory(): Promise<void> {
    if (!state.activeBatchId) return;
    try {
        const info = await evalTS("timesheetActiveFile" as any);
        if (!info || !info.hasFile || !info.territory) return;
        let code: string | null = null;
        try { code = await evalTS("getTerritoryCountryCode", info.territory); } catch { /* decorative */ }
        const batches = state.batches.map((b) => (b.id !== state.activeBatchId ? b : { ...b, territoryName: info.territory, territoryCode: code }));
        patch({ batches });
        persistBatches();
    } catch { /* no bridge */ }
}

export async function startTracking(): Promise<void> {
    if (!state.activeBatchId || state.running) return;
    lastCommitAt = Date.now();
    tickCount = 0;
    patch({ running: true });
    ensurePolling();
    try {
        const info = await evalTS("timesheetActiveFile" as any);
        const newPath = info && info.hasFile ? info.path : null;
        if (newPath) {
            const b = state.activeBatchId;
            const batches = state.batches.map((x) =>
                x.id !== b || x.files.some((f) => f.path === newPath)
                    ? x
                    : { ...x, files: [...x.files, { path: newPath, name: info.name || newPath, jobString: info.jobString || "", seconds: 0 }] }
            );
            patch({ batches, activePath: newPath });
            persistBatches();
            await maybeAutoFillTerritory(info.territory);
        }
    } catch {
        // no bridge (browser preview) -- clock still runs, no file logging.
    }
}

export function pauseTracking() {
    if (!state.running) return;
    commitElapsed(Date.now());
    patch({ running: false });
    stopPollingIfIdle();
}

// --- Hook --------------------------------------------------------------

export function useTimeTracker() {
    loadOnce();
    const [, force] = useState(0);
    useEffect(() => {
        const listener = () => force((n) => n + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    const activeBatch = state.batches.find((b) => b.id === state.activeBatchId) || null;
    const liveDelta = state.running ? Math.max(0, (Date.now() - lastCommitAt) / 1000) : 0;
    const batchTotalSeconds = (b: Batch) => b.elapsedSeconds;

    return {
        batches: state.batches,
        activeBatch,
        running: state.running,
        activePath: state.activePath,
        loaded: state.loaded,
        territories: state.territories,
        categories: state.categories,
        liveDelta,
        batchTotal: activeBatch ? activeBatch.elapsedSeconds + liveDelta : 0,
        fileLiveSeconds: (f: BatchFile) => f.seconds + (state.running && f.path === state.activePath ? liveDelta : 0),
        batchTotalSeconds,
        createBatch,
        openBatch,
        backToList,
        removeBatch,
        removeFile,
        setFileSeconds,
        setCategory,
        refreshTerritory,
        startTracking,
        pauseTracking,
    };
}
