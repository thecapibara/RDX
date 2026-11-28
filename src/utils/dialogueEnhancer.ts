/**
 * Cinema Audio Engine & DialogueEnhancerController v4
 *
 * Supports 5 instant zero-lag WebAudio EQ & Dynamics presets:
 * - "off"        — Стандарт (bit-transparent bypass, 0% DSP)
 * - "dialogue"   — Чіткі діалоги 2.0 (135Hz HPF, +6.5dB @ 1.85kHz, +4dB @ 3.3kHz, 8:1 compressor)
 * - "cinema"     — Кінотеатр (глибокий теплий бас +5.5dB @ 85Hz, чиста середина, +3.5dB air @ 8.5kHz)
 * - "night"      — Нічний режим (сильна компресія 12:1 @ -30dB, приглушені вибухи, чіткий шепіт)
 * - "headphones" — Навушники (об'ємний бас +3.5dB @ 75Hz, +3dB presence, +4dB кришталеві високі @ 10kHz)
 *
 * Linux WebKitGTK Safeguards:
 * - Uses `{ latencyHint: "interactive" }` + `outputGate` GainNode (0ms mute on pause/seeking,
 *   14ms click-free linear ramp on play/seeked) eliminating PipeWire ringbuffer tails.
 * - Global capture-phase gesture unlocker + hard `ctx.state === "running"` gate guarantees
 *   `<video>` is NEVER muted by a suspended AudioContext.
 */

export type AudioPreset = "off" | "dialogue" | "cinema" | "night" | "headphones";

export const AUDIO_PRESET_META: {
  id: AudioPreset;
  label: string;
  shortLabel: string;
  desc: string;
}[] = [
  {
    id: "off",
    label: "Стандарт",
    shortLabel: "Станд.",
    desc: "Оригінальна звукова доріжка без обробки",
  },
  {
    id: "dialogue",
    label: "🎙️ Чіткі діалоги",
    shortLabel: "Діалоги",
    desc: "Виділяє голоси акторів та згладжує гучні перепади",
  },
  {
    id: "cinema",
    label: "🎬 Кінотеатр",
    shortLabel: "Кіно",
    desc: "Глибокий об'ємний бас, чиста середина та кришталеві деталі",
  },
  {
    id: "night",
    label: "🌙 Нічний режим",
    shortLabel: "Ніч",
    desc: "Тихі вибухи й музика, але добре чути навіть шепіт",
  },
  {
    id: "headphones",
    label: "🎧 Навушники",
    shortLabel: "Навушн.",
    desc: "Теплий низ + повітряна чіткість для перегляду в навушниках",
  },
];

const AUDIO_PRESET_STORAGE_KEY = "rdx_audio_preset";

export function getSavedAudioPreset(): AudioPreset {
  if (typeof window === "undefined") return "off";
  try {
    const raw = localStorage.getItem(AUDIO_PRESET_STORAGE_KEY);
    if (
      raw === "dialogue" ||
      raw === "cinema" ||
      raw === "night" ||
      raw === "headphones"
    ) {
      return raw;
    }
  } catch {}
  return "off";
}

export function saveAudioPreset(preset: AudioPreset): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUDIO_PRESET_STORAGE_KEY, preset);
  } catch {}
}

let sharedAudioCtx: AudioContext | null = null;
let unlockListenersAttached = false;
const stateListeners = new Set<() => void>();

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/**
 * Must be called synchronously inside a user gesture (click / pointerdown / keydown)
 * so WebKitGTK / Safari / Chromium immediately transition AudioContext to `"running"`.
 */
export function unlockSharedAudioContext(): AudioContext | null {
  const AudioCtx = getAudioContextConstructor();
  if (!AudioCtx) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    try {
      try {
        sharedAudioCtx = new AudioCtx({ latencyHint: "interactive" });
      } catch {
        sharedAudioCtx = new AudioCtx();
      }
      sharedAudioCtx.addEventListener("statechange", () => {
        if (sharedAudioCtx?.state === "running") {
          stateListeners.forEach((fn) => {
            try {
              fn();
            } catch {}
          });
        }
      });
    } catch {
      return null;
    }
  }

  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume().catch(() => {});
  }

  return sharedAudioCtx;
}

export function installGlobalAudioUnlock(): void {
  if (unlockListenersAttached || typeof window === "undefined") return;
  unlockListenersAttached = true;

  const onUserGesture = () => {
    const ctx = unlockSharedAudioContext();
    if (ctx && ctx.state === "running") {
      window.removeEventListener("pointerdown", onUserGesture, true);
      window.removeEventListener("keydown", onUserGesture, true);
      window.removeEventListener("click", onUserGesture, true);
    }
  };

  window.addEventListener("pointerdown", onUserGesture, { capture: true, passive: true });
  window.addEventListener("keydown", onUserGesture, { capture: true, passive: true });
  window.addEventListener("click", onUserGesture, { capture: true, passive: true });
}

installGlobalAudioUnlock();

interface VideoAudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  band1: BiquadFilterNode; // Highpass / Low-shelf
  band2: BiquadFilterNode; // Low-mid shelf / mud cut
  band3: BiquadFilterNode; // Vocal presence peak
  band4: BiquadFilterNode; // Clarity / Air high-shelf
  compressor: DynamicsCompressorNode;
  makeupGain: GainNode;
  analyser: AnalyserNode;
  outputGate: GainNode;
  mode: "bypass" | "enhanced";
  activePreset: AudioPreset;
}

type VideoWithAudioGraph = HTMLVideoElement & { __rdxAudioGraph?: VideoAudioGraph };

function getCachedGraph(video: HTMLVideoElement): VideoAudioGraph | undefined {
  return (video as VideoWithAudioGraph).__rdxAudioGraph;
}

function setCachedGraph(video: HTMLVideoElement, graph: VideoAudioGraph): void {
  (video as VideoWithAudioGraph).__rdxAudioGraph = graph;
}

export function isStreamSafeForWebAudio(video: HTMLVideoElement): boolean {
  const src = video.currentSrc || video.src || "";
  if (!src) return false;
  if (
    src.startsWith("blob:") ||
    src.startsWith("http://127.0.0.1:") ||
    src.startsWith("http://localhost:") ||
    src.startsWith("asset:") ||
    src.startsWith("http://asset.localhost") ||
    src.startsWith("https://asset.localhost") ||
    src.startsWith("data:")
  ) {
    return true;
  }
  return video.crossOrigin === "anonymous" && video.readyState >= 2;
}

function applyPresetParameters(graph: VideoAudioGraph, preset: AudioPreset): void {
  const t = graph.ctx.currentTime;
  const setParam = (p: AudioParam, v: number) => {
    try {
      p.setTargetAtTime(v, t, 0.015);
    } catch {
      p.value = v;
    }
  };

  if (preset === "dialogue") {
    graph.band1.type = "highpass";
    setParam(graph.band1.frequency, 135);
    setParam(graph.band1.Q, 0.7);
    setParam(graph.band1.gain, 0);

    graph.band2.type = "lowshelf";
    setParam(graph.band2.frequency, 180);
    setParam(graph.band2.gain, -3.5);

    graph.band3.type = "peaking";
    setParam(graph.band3.frequency, 1850);
    setParam(graph.band3.Q, 0.85);
    setParam(graph.band3.gain, 6.5);

    graph.band4.type = "peaking";
    setParam(graph.band4.frequency, 3300);
    setParam(graph.band4.Q, 1.0);
    setParam(graph.band4.gain, 4.0);

    setParam(graph.compressor.threshold, -26);
    setParam(graph.compressor.knee, 22);
    setParam(graph.compressor.ratio, 8);
    setParam(graph.compressor.attack, 0.003);
    setParam(graph.compressor.release, 0.2);
    setParam(graph.makeupGain.gain, 1.42);
  } else if (preset === "cinema") {
    graph.band1.type = "lowshelf";
    setParam(graph.band1.frequency, 85);
    setParam(graph.band1.gain, 5.5);

    graph.band2.type = "peaking";
    setParam(graph.band2.frequency, 320);
    setParam(graph.band2.Q, 0.9);
    setParam(graph.band2.gain, -1.8);

    graph.band3.type = "peaking";
    setParam(graph.band3.frequency, 2800);
    setParam(graph.band3.Q, 0.9);
    setParam(graph.band3.gain, 2.6);

    graph.band4.type = "highshelf";
    setParam(graph.band4.frequency, 8500);
    setParam(graph.band4.gain, 3.5);

    setParam(graph.compressor.threshold, -14);
    setParam(graph.compressor.knee, 16);
    setParam(graph.compressor.ratio, 3);
    setParam(graph.compressor.attack, 0.008);
    setParam(graph.compressor.release, 0.22);
    setParam(graph.makeupGain.gain, 1.08);
  } else if (preset === "night") {
    graph.band1.type = "highpass";
    setParam(graph.band1.frequency, 120);
    setParam(graph.band1.Q, 0.7);
    setParam(graph.band1.gain, 0);

    graph.band2.type = "lowshelf";
    setParam(graph.band2.frequency, 145);
    setParam(graph.band2.gain, -5.5);

    graph.band3.type = "peaking";
    setParam(graph.band3.frequency, 2000);
    setParam(graph.band3.Q, 0.8);
    setParam(graph.band3.gain, 4.5);

    graph.band4.type = "highshelf";
    setParam(graph.band4.frequency, 7500);
    setParam(graph.band4.gain, -1.5);

    setParam(graph.compressor.threshold, -30);
    setParam(graph.compressor.knee, 26);
    setParam(graph.compressor.ratio, 12);
    setParam(graph.compressor.attack, 0.002);
    setParam(graph.compressor.release, 0.25);
    setParam(graph.makeupGain.gain, 1.55);
  } else if (preset === "headphones") {
    graph.band1.type = "lowshelf";
    setParam(graph.band1.frequency, 75);
    setParam(graph.band1.gain, 3.8);

    graph.band2.type = "peaking";
    setParam(graph.band2.frequency, 450);
    setParam(graph.band2.Q, 0.85);
    setParam(graph.band2.gain, -1.2);

    graph.band3.type = "peaking";
    setParam(graph.band3.frequency, 2600);
    setParam(graph.band3.Q, 0.9);
    setParam(graph.band3.gain, 3.0);

    graph.band4.type = "highshelf";
    setParam(graph.band4.frequency, 10000);
    setParam(graph.band4.gain, 4.2);

    setParam(graph.compressor.threshold, -20);
    setParam(graph.compressor.knee, 18);
    setParam(graph.compressor.ratio, 4);
    setParam(graph.compressor.attack, 0.005);
    setParam(graph.compressor.release, 0.2);
    setParam(graph.makeupGain.gain, 1.15);
  }

  graph.activePreset = preset;
}

function getOrCreateGraph(
  video: HTMLVideoElement,
  ctx: AudioContext
): VideoAudioGraph | null {
  const existing = getCachedGraph(video);
  if (existing) return existing;

  try {
    const source = ctx.createMediaElementSource(video);
    const band1 = ctx.createBiquadFilter();
    const band2 = ctx.createBiquadFilter();
    const band3 = ctx.createBiquadFilter();
    const band4 = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    const makeupGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    const outputGate = ctx.createGain();
    outputGate.gain.value = video.paused ? 0 : 1;

    const muteGateNow = () => {
      try {
        const t = ctx.currentTime;
        outputGate.gain.cancelScheduledValues(t);
        outputGate.gain.setValueAtTime(0, t);
      } catch {}
    };

    const unmuteGateSmooth = () => {
      if (video.paused) return;
      try {
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }
        const t = ctx.currentTime;
        outputGate.gain.cancelScheduledValues(t);
        outputGate.gain.setValueAtTime(Math.max(0.0001, outputGate.gain.value), t);
        outputGate.gain.linearRampToValueAtTime(1, t + 0.014);
      } catch {}
    };

    video.addEventListener("pause", muteGateNow);
    video.addEventListener("seeking", muteGateNow);
    video.addEventListener("play", unmuteGateSmooth);
    video.addEventListener("playing", unmuteGateSmooth);
    video.addEventListener("seeked", unmuteGateSmooth);

    band1.connect(band2);
    band2.connect(band3);
    band3.connect(band4);
    band4.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(analyser);

    source.connect(outputGate);
    outputGate.connect(ctx.destination);

    const graph: VideoAudioGraph = {
      ctx,
      source,
      band1,
      band2,
      band3,
      band4,
      compressor,
      makeupGain,
      analyser,
      outputGate,
      mode: "bypass",
      activePreset: "off",
    };
    setCachedGraph(video, graph);
    return graph;
  } catch (err) {
    console.warn("RDX Cinema Audio Engine init skipped:", err);
    return null;
  }
}

export class DialogueEnhancerController {
  private video: HTMLVideoElement;
  private wantPreset: AudioPreset = "off";
  private watchdogTimer: number | null = null;
  private silentStrikes = 0;
  private onUnavailable?: (reason: string) => void;
  private onNeedElementReset?: () => void;
  private onCtxUnlocked = () => {
    if (this.wantPreset !== "off") {
      this.syncPreset(this.wantPreset);
    }
  };

  constructor(
    video: HTMLVideoElement,
    onUnavailable?: (reason: string) => void,
    onNeedElementReset?: () => void
  ) {
    this.video = video;
    this.onUnavailable = onUnavailable;
    this.onNeedElementReset = onNeedElementReset;
    stateListeners.add(this.onCtxUnlocked);
  }

  /** Legacy boolean helper (maps true -> "dialogue", false -> "off") */
  public sync(enabled: boolean): boolean {
    return this.syncPreset(enabled ? "dialogue" : "off");
  }

  public syncPreset(preset: AudioPreset): boolean {
    this.wantPreset = preset;
    this.clearWatchdog();

    if (preset === "off") {
      const existing = getCachedGraph(this.video);
      if (existing) {
        if (existing.ctx.state === "suspended") {
          existing.ctx.resume().catch(() => {});
        }
        if (existing.mode !== "bypass") {
          try {
            existing.source.disconnect();
            existing.analyser.disconnect();
            existing.source.connect(existing.outputGate);
            existing.mode = "bypass";
            existing.activePreset = "off";
          } catch {}
        }
      }
      return false;
    }

    if (this.video.readyState < 2 || !isStreamSafeForWebAudio(this.video)) {
      return false;
    }

    const ctx = unlockSharedAudioContext();
    if (!ctx) return false;

    if (ctx.state !== "running") {
      ctx.resume().catch(() => {});
      return false;
    }

    const graph = getOrCreateGraph(this.video, ctx);
    if (!graph) return false;

    applyPresetParameters(graph, preset);

    if (graph.mode !== "enhanced") {
      try {
        graph.source.disconnect();
        graph.analyser.disconnect();

        graph.source.connect(graph.band1);
        graph.analyser.connect(graph.outputGate);
        graph.mode = "enhanced";
      } catch {
        return false;
      }
    }

    this.startSilenceWatchdog(graph);
    return true;
  }

  private startSilenceWatchdog(graph: VideoAudioGraph) {
    this.silentStrikes = 0;
    const buf = new Float32Array(graph.analyser.fftSize);

    this.watchdogTimer = window.setInterval(() => {
      if (
        this.video.paused ||
        this.video.ended ||
        this.video.muted ||
        this.video.volume < 0.05 ||
        this.video.readyState < 3
      ) {
        this.silentStrikes = 0;
        return;
      }

      if (graph.ctx.state === "suspended") {
        graph.ctx.resume().catch(() => {});
      }

      graph.analyser.getFloatTimeDomainData(buf);
      let maxAbs = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > maxAbs) maxAbs = v;
      }

      if (maxAbs < 1e-6) {
        this.silentStrikes++;
        if (this.silentStrikes >= 6) {
          this.wantPreset = "off";
          this.syncPreset("off");
          this.onUnavailable?.("Відновлено прямий аудіоканал для цього кодека");
          this.onNeedElementReset?.();
        }
      } else {
        this.clearWatchdog();
      }
    }, 500);
  }

  private clearWatchdog() {
    if (this.watchdogTimer !== null) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  public destroy() {
    this.wantPreset = "off";
    stateListeners.delete(this.onCtxUnlocked);
    this.clearWatchdog();
    const existing = getCachedGraph(this.video);
    if (existing && existing.mode !== "bypass") {
      try {
        existing.source.disconnect();
        existing.analyser.disconnect();
        existing.source.connect(existing.outputGate);
        existing.mode = "bypass";
        existing.activePreset = "off";
      } catch {}
    }
  }
}
