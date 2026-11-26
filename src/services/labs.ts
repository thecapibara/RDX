/**
 * RDX Labs — Experimental Features Store, Master Kill-Switch & Eco Battery Manager
 *
 * Guarantees:
 * - Master switch `enabled = false` (default) immediately forces ALL experimental
 *   features to inactive ("off" / false) with zero CPU/GPU/DOM overhead, while
 *   preserving individual user sub-toggles in storage for when Labs is re-enabled.
 * - Eco-Mode ("on" or "auto_battery" when unplugged & <= 30%) temporarily switches
 *   surface variables to pure #000000 OLED without overwriting user's saved theme,
 *   pauses GPU-heavy Labs shaders/Ambilight, and caps auto quality to 720p.
 */

import { useEffect, useState } from "react";
import { initThemes } from "./theme";

export type FrameBoostMode = "off" | "smooth" | "flow";
export type SmartUpscaleMode = "off" | "auto" | "cinema" | "anime";
export type IntroSkipMode = "off" | "button" | "auto";
export type EcoPowerMode = "off" | "on" | "auto_battery";

export interface LabsSettings {
  /** Master kill-switch. When false, every experimental feature is inactive. */
  enabled: boolean;
  /** Real-time 24fps -> 48/60fps interpolation */
  frameBoost: FrameBoostMode;
  /** Vendor-agnostic GLSL spatial upscaling (Intel iGPU / NVIDIA / AMD / Apple) */
  smartUpscale: SmartUpscaleMode;
  /** Dynamic 32x18 Cinema Ambilight behind black letterbox/pillarbox bars */
  ambilight: boolean;
  /** WebVTT sprite perceptual dHash intro detection + manual season memory */
  introSkip: IntroSkipMode;
  /** Mid/Side center speech enhancer + compressor with silence watchdog */
  dialogueBoost: boolean;
  /** Laptop battery saver (OLED #000000 + 720p cap + GPU shader pause) */
  ecoMode: EcoPowerMode;
}

export interface EffectiveLabsState {
  raw: LabsSettings;
  isActive: boolean;
  ecoActive: boolean;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  frameBoost: FrameBoostMode;
  smartUpscale: SmartUpscaleMode;
  ambilight: boolean;
  introSkip: IntroSkipMode;
  dialogueBoost: boolean;
}

const STORAGE_KEY = "rdx_labs_v1";
const CHANGE_EVENT = "rdx:labs-changed";

export const DEFAULT_LABS_SETTINGS: LabsSettings = {
  enabled: false,
  frameBoost: "off",
  smartUpscale: "off",
  ambilight: false,
  introSkip: "off",
  dialogueBoost: false,
  ecoMode: "off",
};

let batteryMonitorInitialized = false;
let currentBatteryLevel: number | null = null;
let currentBatteryCharging: boolean | null = null;
let wasEcoDomApplied = false;

function sanitizeSettings(input: Partial<LabsSettings> | null | undefined): LabsSettings {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_LABS_SETTINGS };
  }
  const frameBoost: FrameBoostMode =
    input.frameBoost === "smooth" || input.frameBoost === "flow" ? input.frameBoost : "off";
  const smartUpscale: SmartUpscaleMode =
    input.smartUpscale === "auto" ||
    input.smartUpscale === "cinema" ||
    input.smartUpscale === "anime"
      ? input.smartUpscale
      : "off";
  const introSkip: IntroSkipMode =
    input.introSkip === "button" || input.introSkip === "auto" ? input.introSkip : "off";
  const ecoMode: EcoPowerMode =
    input.ecoMode === "on" || input.ecoMode === "auto_battery" ? input.ecoMode : "off";

  return {
    enabled: Boolean(input.enabled),
    frameBoost,
    smartUpscale,
    ambilight: Boolean(input.ambilight),
    introSkip,
    dialogueBoost: Boolean(input.dialogueBoost),
    ecoMode,
  };
}

export function getLabsSettings(): LabsSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_LABS_SETTINGS };
  }
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (!rawStr) return { ...DEFAULT_LABS_SETTINGS };
    return sanitizeSettings(JSON.parse(rawStr));
  } catch {
    return { ...DEFAULT_LABS_SETTINGS };
  }
}

function isEcoCurrentlyTriggered(raw: LabsSettings): boolean {
  if (!raw.enabled) return false;
  if (raw.ecoMode === "on") return true;
  if (raw.ecoMode === "auto_battery") {
    if (
      currentBatteryCharging === false &&
      currentBatteryLevel !== null &&
      currentBatteryLevel <= 0.3
    ) {
      return true;
    }
  }
  return false;
}

function syncEcoDomTheme(ecoActive: boolean) {
  if (typeof document === "undefined") return;
  if (ecoActive) {
    wasEcoDomApplied = true;
    document.documentElement.setAttribute("data-eco", "true");
    document.documentElement.style.setProperty("--bg-base", "#000000");
    document.documentElement.style.setProperty("--bg-surface", "#040406");
    document.documentElement.style.setProperty("--bg-elevated", "#0b0b0f");
    if (document.body) {
      document.body.style.backgroundColor = "#000000";
    }
  } else if (wasEcoDomApplied) {
    wasEcoDomApplied = false;
    document.documentElement.removeAttribute("data-eco");
    initThemes();
  }
}

function ensureBatteryMonitor() {
  if (batteryMonitorInitialized || typeof navigator === "undefined") return;
  batteryMonitorInitialized = true;

  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      addEventListener: (type: string, listener: () => void) => void;
    }>;
  };

  if (typeof nav.getBattery === "function") {
    nav
      .getBattery()
      .then((bat) => {
        const update = () => {
          currentBatteryLevel = bat.level;
          currentBatteryCharging = bat.charging;
          const raw = getLabsSettings();
          syncEcoDomTheme(isEcoCurrentlyTriggered(raw));
          window.dispatchEvent(new Event(CHANGE_EVENT));
        };
        currentBatteryLevel = bat.level;
        currentBatteryCharging = bat.charging;
        syncEcoDomTheme(isEcoCurrentlyTriggered(getLabsSettings()));
        bat.addEventListener("levelchange", update);
        bat.addEventListener("chargingchange", update);
      })
      .catch(() => {});
  }
}

export function getEffectiveLabsState(): EffectiveLabsState {
  ensureBatteryMonitor();
  const raw = getLabsSettings();

  if (!raw.enabled) {
    syncEcoDomTheme(false);
    return {
      raw,
      isActive: false,
      ecoActive: false,
      batteryLevel: currentBatteryLevel,
      batteryCharging: currentBatteryCharging,
      frameBoost: "off",
      smartUpscale: "off",
      ambilight: false,
      introSkip: "off",
      dialogueBoost: false,
    };
  }

  const ecoActive = isEcoCurrentlyTriggered(raw);
  syncEcoDomTheme(ecoActive);

  return {
    raw,
    isActive: true,
    ecoActive,
    batteryLevel: currentBatteryLevel,
    batteryCharging: currentBatteryCharging,
    // Eco mode pauses GPU-intensive visual shaders & Ambilight to extend battery life
    frameBoost: ecoActive ? "off" : raw.frameBoost,
    smartUpscale: ecoActive ? "off" : raw.smartUpscale,
    ambilight: ecoActive ? false : raw.ambilight,
    introSkip: raw.introSkip,
    dialogueBoost: raw.dialogueBoost,
  };
}

export function updateLabsSettings(patch: Partial<LabsSettings>): EffectiveLabsState {
  const current = getLabsSettings();
  const next = sanitizeSettings({ ...current, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  const effective = getEffectiveLabsState();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return effective;
}

export function applyRecommendedLabsPreset(): EffectiveLabsState {
  return updateLabsSettings({
    enabled: true,
    frameBoost: "smooth",
    smartUpscale: "auto",
    ambilight: true,
    introSkip: "button",
    dialogueBoost: false,
    ecoMode: "auto_battery",
  });
}

export function resetLabsSettings(): EffectiveLabsState {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_LABS_SETTINGS));
  } catch {}
  const effective = getEffectiveLabsState();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return effective;
}

export function countActiveLabsFeatures(state: EffectiveLabsState): number {
  if (!state.isActive) return 0;
  let count = 0;
  if (state.frameBoost !== "off") count++;
  if (state.smartUpscale !== "off") count++;
  if (state.ambilight) count++;
  if (state.introSkip !== "off") count++;
  if (state.dialogueBoost) count++;
  if (state.raw.ecoMode !== "off") count++;
  return count;
}

export function useLabsSettings(): EffectiveLabsState {
  const [state, setState] = useState<EffectiveLabsState>(() => getEffectiveLabsState());

  useEffect(() => {
    ensureBatteryMonitor();
    const sync = () => setState(getEffectiveLabsState());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return state;
}
