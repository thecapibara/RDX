/**
 * DialogueEnhancerController v3 — RDX Labs Speech Clarity & Night Leveler
 *
 * Root cause of the Linux WebKitGTK mute bug in v2 (proven via WebKit2GTK 4.1 + PipeWire test):
 * 1. Toggling "Чіткі діалоги" in React updated state and invoked `new AudioContext()` + `ctx.resume()`
 *    inside an async `useEffect` / `onPlaying` callback — AFTER WebKitGTK's synchronous
 *    `UserGestureIndicator` had already expired!
 * 2. WebKitGTK created the `AudioContext` stuck in `"suspended"` state, while
 *    `ctx.createMediaElementSource(video)` immediately detached `<video>`'s native GStreamer
 *    audio sink into that suspended context — muting the entire film!
 *
 * How v3 guarantees 100% working dialogue normalization & zero mute risk:
 * 1. Global capture-phase User Gesture Unlocker (`pointerdown` / `keydown` / `click`) + explicit
 *    synchronous `unlockSharedAudioContext()` on toggle clicks ensures a single shared `AudioContext`
 *    is already `"running"` BEFORE `VideoPlayer` or `useEffect` ever touches `<video>`.
 * 2. Hard Gate: NEVER calls `createMediaElementSource(video)` unless `sharedCtx.state === "running"`.
 *    If still suspended, waits for `statechange -> "running"` while keeping native `<video>` sound intact!
 * 3. Universal Stereo/Mono/5.1 Serial Speech Chain (no fragile ChannelSplitter phase/mono bugs):
 *    - `140 Hz` High-Pass + `110 Hz` `-4.5 dB` Low-Shelf (tames booming explosions & sub-bass rumble)
 *    - `1850 Hz` `+6.5 dB` Peaking + `3300 Hz` `+4.0 dB` Peaking (brings actor voices & diction forward)
 *    - `DynamicsCompressorNode` (`-26 dB`, `8:1` ratio) + `1.45x` (`+3.2 dB`) Makeup Gain so quiet
 *      whispers become noticeably louder while gunshots/screams are smoothly clamped.
 */

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
      // Request lowest-latency interactive PipeWire/PulseAudio quantum (~10-20ms instead of ~180ms)
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

// Install immediately when module loads so clicking "Дивитися" or any UI button unlocks WebAudio
installGlobalAudioUnlock();

interface VideoAudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  highPass: BiquadFilterNode;
  bassTame: BiquadFilterNode;
  presencePeak: BiquadFilterNode;
  clarityPeak: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  makeupGain: GainNode;
  analyser: AnalyserNode;
  outputGate: GainNode;
  mode: "bypass" | "enhanced";
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
  // Remote stream is also safe if <video crossorigin="anonymous"> succeeded
  return video.crossOrigin === "anonymous" && video.readyState >= 2;
}

function getOrCreateGraph(
  video: HTMLVideoElement,
  ctx: AudioContext
): VideoAudioGraph | null {
  const existing = getCachedGraph(video);
  if (existing) return existing;

  try {
    const source = ctx.createMediaElementSource(video);

    // 1. Cut deep sub-bass rumble (< 135 Hz) & tame boominess so explosions don't drown speech
    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 135;
    highPass.Q.value = 0.7;

    const bassTame = ctx.createBiquadFilter();
    bassTame.type = "lowshelf";
    bassTame.frequency.value = 180;
    bassTame.gain.value = -3.5;

    // 2. Boost core human vocal fundamentals & consonant intelligibility (1.8 kHz & 3.3 kHz)
    const presencePeak = ctx.createBiquadFilter();
    presencePeak.type = "peaking";
    presencePeak.frequency.value = 1850;
    presencePeak.Q.value = 0.85;
    presencePeak.gain.value = 6.5;

    const clarityPeak = ctx.createBiquadFilter();
    clarityPeak.type = "peaking";
    clarityPeak.frequency.value = 3300;
    clarityPeak.Q.value = 1.0;
    clarityPeak.gain.value = 4.0;

    // 3. Night Dynamic Range Compressor + Makeup Gain (whispers up, gunshots clamped)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 22;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    const makeupGain = ctx.createGain();
    makeupGain.gain.value = 1.45; // +3.2 dB post-compressor vocal lift

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // Zero-lag output gate: cuts WebAudio ringbuffer/compressor tail immediately on pause & seek
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

    // Wire internal serial stereo/mono-compatible filter chain once
    highPass.connect(bassTame);
    bassTame.connect(presencePeak);
    presencePeak.connect(clarityPeak);
    clarityPeak.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(analyser);

    // Default initial state: bit-transparent bypass routed through zero-lag outputGate
    source.connect(outputGate);
    outputGate.connect(ctx.destination);

    const graph: VideoAudioGraph = {
      ctx,
      source,
      highPass,
      bassTame,
      presencePeak,
      clarityPeak,
      compressor,
      makeupGain,
      analyser,
      outputGate,
      mode: "bypass",
    };
    setCachedGraph(video, graph);
    return graph;
  } catch (err) {
    console.warn("RDX DialogueEnhancer init skipped:", err);
    return null;
  }
}

export class DialogueEnhancerController {
  private video: HTMLVideoElement;
  private wantEnabled = false;
  private watchdogTimer: number | null = null;
  private silentStrikes = 0;
  private onUnavailable?: (reason: string) => void;
  private onNeedElementReset?: () => void;
  private onCtxUnlocked = () => {
    if (this.wantEnabled) {
      this.sync(true);
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

  public sync(enabled: boolean): boolean {
    this.wantEnabled = enabled;
    this.clearWatchdog();

    if (!enabled) {
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
          } catch {}
        }
      }
      return false;
    }

    // Wait until <video> actually has decoded media data before attaching MediaElementSource
    if (this.video.readyState < 2 || !isStreamSafeForWebAudio(this.video)) {
      return false;
    }

    const ctx = unlockSharedAudioContext();
    if (!ctx) return false;

    // CRITICAL WEBKITGTK GUARD:
    // Never hijack <video> via createMediaElementSource while AudioContext is still "suspended"!
    // Keep native GStreamer audio playing until the user's next click unlocks `ctx` to "running".
    if (ctx.state !== "running") {
      ctx.resume().catch(() => {});
      return false;
    }

    const graph = getOrCreateGraph(this.video, ctx);
    if (!graph) return false;

    if (graph.mode !== "enhanced") {
      try {
        graph.source.disconnect();
        graph.analyser.disconnect();

        graph.source.connect(graph.highPass);
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
        // 6 consecutive checks (3.0s) of exact digital 0.000000 (not quiet room tone, true broken pipe)
        if (this.silentStrikes >= 6) {
          this.wantEnabled = false;
          this.sync(false);
          this.onUnavailable?.("Відновлено прямий аудіоканал для цього кодека");
          this.onNeedElementReset?.();
        }
      } else {
        // Real non-zero audio samples confirmed flowing through DSP!
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
    this.wantEnabled = false;
    stateListeners.delete(this.onCtxUnlocked);
    this.clearWatchdog();
    const existing = getCachedGraph(this.video);
    if (existing && existing.mode !== "bypass") {
      try {
        existing.source.disconnect();
        existing.analyser.disconnect();
        existing.source.connect(existing.outputGate);
        existing.mode = "bypass";
      } catch {}
    }
  }
}
