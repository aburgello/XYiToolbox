// =============================================================================
// src/js/lib/utils/sfx.ts
// -----------------------------------------------------------------------------
// Tiny sound-effect utility using Web Audio API. Bundled audio files:
//   - "click":  mixkit-cool-interface-click-tone-2568.wav (standalone action clicks --
//               category cards, workflow-card opens, toggles)
//   - "menu":   u_o8xh7gwsrj-app_interface_click_2 (switching WITHIN an existing
//               menu/tab set -- CampaignLocaliser/ReviewHub tabs, rail row select)
//   - "bop":    cartoon-bubble-ascending-pops-gfx-sounds-low (batch import events)
//   - "ding":   notification-metallic-ding-echo-epic-stock-media (success)
//   - "beep":   ui-alert-synth-beep-epic-stock-media (error / Un-Turk It)
//
// All files are preloaded via import (Vite bundles them as URLs) and decoded
// into AudioBuffers on first AudioContext creation, so there's NO first-play
// delay — by the time the user clicks anything, buffers are ready.
//
// Off by default (see `enabled` below) -- this is a shared studio-floor tool,
// so sound is opt-in, not opt-on. The real value is loaded once from
// app.settings (loadSfxEnabled/saveSfxEnabled in aeft.ts) by whichever
// component mounts first (HomeScreen) via sfx.setEnabled(); that persists
// for the life of the module regardless of which screen is showing, same
// singleton-module pattern as hooks/useTimeTracker.ts.
//
// Usage:
//   import { sfx } from "../lib/utils/sfx";
//   sfx.click();
//   sfx.menu();    // switching tabs/rail rows within a menu
//   sfx.bop();     // import / batch operations
//   sfx.success();
//   sfx.error();
// =============================================================================

import clickWav from "./mixkit-cool-interface-click-tone-2568.wav";
import menuMp3 from "./u_o8xh7gwsrj-app_interface_click_2-476372.mp3";
import bopMp3 from "./cartoon-bubble-ascending-pops-gfx-sounds-low-2-00-00.mp3";
import dingMp3 from "./notification-metallic-ding-echo-epic-stock-media-1-00-01.mp3";
import beepMp3 from "./ui-alert-synth-beep-epic-stock-media-1-00-00.mp3";

let ctx: AudioContext | null = null;
const buffers: Record<string, AudioBuffer | null> = {
    click: null,
    menu: null,
    bop: null,
    ding: null,
    beep: null,
};
const loaded = new Set<string>();
const loading = new Set<string>();

const FILE_MAP: Record<string, string> = {
    click: clickWav,
    menu: menuMp3,
    bop: bopMp3,
    ding: dingMp3,
    beep: beepMp3,
};

const getCtx = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctx) {
        try {
            const AC = window.AudioContext || (window as any).webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        } catch {
            return null;
        }
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
};

const loadBuffer = async (ac: AudioContext, name: string): Promise<AudioBuffer | null> => {
    if (loaded.has(name) || loading.has(name)) return buffers[name];
    loading.add(name);
    try {
        const res = await fetch(FILE_MAP[name]);
        const buf = await res.arrayBuffer();
        const decoded = await ac.decodeAudioData(buf);
        buffers[name] = decoded;
        loaded.add(name);
        return decoded;
    } catch {
        return null;
    } finally {
        loading.delete(name);
    }
};

// Master volume multiplier (0-1), on top of each sound's own tuned gain
// below -- this is what a user-facing volume slider controls. Defaults to
// 1 (no attenuation) until the real persisted value loads; each preset's own
// gain was already tuned for "quiet by default", so 1 here just means "use
// those tuned values as-is", not "full blast".
let masterVolume = 1;

const playBuffer = (name: string, volume: number) => {
    const ac = getCtx();
    if (!ac) return;
    if (!buffers[name]) {
        // Not yet loaded (preload() hasn't finished, or this is the very
        // first call before it ran) -- kick off the load for next time and
        // skip silently just this once rather than playing nothing useful.
        loadBuffer(ac, name);
        return;
    }
    const src = ac.createBufferSource();
    src.buffer = buffers[name];
    const gain = ac.createGain();
    gain.gain.value = volume * masterVolume;
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
};

// ── Preset sounds ───────────────────────────────────────────────────────────
// Volumes tuned for "low volume, non-intrusive" — these are quiet enough to
// sit under a conversation without being annoying. 0.5 = half gain on a
// short click; the ding/beep are softer since they're longer sounds.

const click = () => playBuffer("click", 0.45);
const toggle = () => playBuffer("click", 0.35);
const open = () => playBuffer("click", 0.4);

// Menu/tab selection -- CampaignLocaliser/ReviewHub tab switches, rail-row
// selection in Localise/Tools. Deliberately a different file than `click`
// so switching within a menu reads as distinct from a standalone action.
const menu = () => playBuffer("menu", 0.35);

// Bubble bop — for batch import operations (delivery comps, review sessions).
const bop = () => playBuffer("bop", 0.5);

const success = () => playBuffer("ding", 0.4);
const error = () => playBuffer("beep", 0.35);

// ── Toggle ───────────────────────────────────────────────────────────────
// Off by default. The real persisted value (app.settings, via
// loadSfxEnabled/saveSfxEnabled) is applied once at HomeScreen mount by
// calling sfx.setEnabled() -- this module-level flag then holds for the
// life of the page regardless of which screen is showing.
let enabled = false;

export const sfx = {
    click,
    toggle,
    success,
    error,
    open,
    menu,
    bop,
    setEnabled: (v: boolean) => { enabled = v; },
    isEnabled: () => enabled,
    // Clamped 0-1. UI-facing volume slider calls this directly.
    setVolume: (v: number) => { masterVolume = Math.max(0, Math.min(1, v)); },
    getVolume: () => masterVolume,
    // Preload all buffers — call on app lifecycle so first interaction is instant.
    preload: () => {
        const ac = getCtx();
        if (!ac) return;
        Object.keys(FILE_MAP).forEach((name) => loadBuffer(ac, name));
    },
};

const wrap = <K extends keyof typeof sfx>(key: K) => {
    if (typeof sfx[key] !== "function") return;
    const orig = sfx[key] as (...args: any[]) => void;
    (sfx as any)[key] = (...args: any[]) => { if (enabled) orig(...args); };
};
wrap("click"); wrap("toggle"); wrap("success"); wrap("error"); wrap("open"); wrap("menu"); wrap("bop");
