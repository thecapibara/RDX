/**
 * RDX Obsidian Crimson - UI Audio Engine
 * Hardware-level native sound dispatch via Rust (rodio/PipeWire) with 0ms latency,
 * zero WebKitGTK bugs, and rate-limiting against rapid mouse sweep.
 */

import { api } from "./api";

// Initialize state from localStorage (default: false, OFF by default)
let uiSoundsEnabled: boolean = (() => {
  try {
    return localStorage.getItem("rdx_ui_sounds") === "true";
  } catch {
    return false;
  }
})();

let lastHoverSoundTime = 0;

export const setUiSoundsEnabled = (enabled: boolean) => {
  uiSoundsEnabled = enabled;
  try {
    localStorage.setItem("rdx_ui_sounds", enabled ? "true" : "false");
  } catch {}
};

export const getUiSoundsEnabled = (): boolean => {
  return uiSoundsEnabled;
};

/**
 * Temporarily suppress hover sound triggers (e.g. when closing modal or navigating back,
 * so the card appearing under the cursor doesn't play an accidental hover sound).
 */
export const suppressHoverSound = (cooldownMs: number = 400) => {
  lastHoverSoundTime = performance.now() + cooldownMs;
};

/**
 * Tactile, warm velvet hover tap (Apple TV / PS5 focus style)
 * Rate-limited to prevent rapid mouse traversal flutter.
 */
export const playHoverSound = () => {
  if (!uiSoundsEnabled) return;
  const now = performance.now();
  if (now < lastHoverSoundTime || now - lastHoverSoundTime < 110) return;
  lastHoverSoundTime = now;

  api.playUiSound("hover");
};

/**
 * Cinematic opening swell when selecting a movie/series card
 */
export const playModalOpenSound = () => {
  if (!uiSoundsEnabled) return;
  api.playUiSound("modal_open");
};
