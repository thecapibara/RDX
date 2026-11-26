/**
 * DialogueEnhancerController — RDX Labs Speech Clarity & Night Leveler 2.0
 *
 * Why legacy WebAudio night-mode previously failed on some streams:
 * 1. Calling `createMediaElementSource(video)` on a non-CORS direct MP4 outputs silence.
 * 2. Disconnecting a `MediaElementAudioSourceNode` without reconnecting it directly to
 *    `audioCtx.destination` leaves the <video> permanently muted!
 *
 * How v2 solves both permanently:
 * - Attaches ONLY when the active <video> stream is CORS-clean (`blob:` MSE HLS or local `asset:`).
 * - Stores a single persistent graph per HTMLVideoElement in a WeakMap and switches cleanly
 *   between DSP routing (Mid speech boost + High-pass + DynamicsCompressor + attenuated Side)
 *   and bit-transparent direct bypass (`source -> destination`).
 * - Includes an automatic RMS Silence Watchdog: if unmuted playback produces 0.0000 output
 *   for ~600ms (e.g. WebKitGTK GStreamer quirk), it immediately notifies/falls back.
 */

interface VideoAudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  splitter: ChannelSplitterNode;
  midGain: GainNode;
  highPass: BiquadFilterNode;
  presencePeak: BiquadFilterNode;
  clarityPeak: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  sideLeftGain: GainNode;
  sideRightGain: GainNode;
  merger: ChannelMergerNode;
  analyser: AnalyserNode;
  mode: "bypass" | "enhanced";
}

const graphRegistry = new WeakMap<HTMLVideoElement, VideoAudioGraph>();

export function isStreamSafeForWebAudio(video: HTMLVideoElement): boolean {
  const src = video.currentSrc || video.src || "";
  if (!src) return false;
  // MSE HLS (`blob:`) and Tauri offline protocol (`asset:` / `http://asset.localhost`) are safe
  return (
    src.startsWith("blob:") ||
    src.startsWith("http://127.0.0.1:") ||
    src.startsWith("asset:") ||
    src.startsWith("http://asset.localhost") ||
    src.startsWith("https://asset.localhost") ||
    src.startsWith("data:")
  );
}

function getOrCreateGraph(video: HTMLVideoElement): VideoAudioGraph | null {
  const existing = graphRegistry.get(video);
  if (existing) return existing;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  try {
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(video);
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    // Mid (Center Dialogue) chain: (L + R) * 0.5 -> HPF 185Hz -> +6dB @ 1.65kHz -> +3dB @ 3.1kHz -> Compressor
    const midGain = ctx.createGain();
    midGain.gain.value = 0.68; // Sums L+R with headroom boost

    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 185; // Strips low-end explosions/rumble from voice channel

    const presencePeak = ctx.createBiquadFilter();
    presencePeak.type = "peaking";
    presencePeak.frequency.value = 1650;
    presencePeak.Q.value = 0.95;
    presencePeak.gain.value = 6.0;

    const clarityPeak = ctx.createBiquadFilter();
    clarityPeak.type = "peaking";
    clarityPeak.frequency.value = 3100;
    clarityPeak.Q.value = 1.1;
    clarityPeak.gain.value = 3.2;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 24;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;

    // Gentle stereo background preservation so music/ambience doesn't collapse to harsh mono
    const sideLeftGain = ctx.createGain();
    sideLeftGain.gain.value = 0.38;
    const sideRightGain = ctx.createGain();
    sideRightGain.gain.value = 0.38;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // Wire fixed internal DSP sub-graph once
    splitter.connect(midGain, 0);
    splitter.connect(midGain, 1);
    midGain.connect(highPass);
    highPass.connect(presencePeak);
    presencePeak.connect(clarityPeak);
    clarityPeak.connect(compressor);
    compressor.connect(merger, 0, 0);
    compressor.connect(merger, 0, 1);

    splitter.connect(sideLeftGain, 0);
    splitter.connect(sideRightGain, 1);
    sideLeftGain.connect(merger, 0, 0);
    sideRightGain.connect(merger, 0, 1);

    // Start in transparent bypass (`source -> destination`)
    source.connect(ctx.destination);

    const graph: VideoAudioGraph = {
      ctx,
      source,
      splitter,
      midGain,
      highPass,
      presencePeak,
      clarityPeak,
      compressor,
      sideLeftGain,
      sideRightGain,
      merger,
      analyser,
      mode: "bypass",
    };
    graphRegistry.set(video, graph);
    return graph;
  } catch (err) {
    console.warn("RDX DialogueEnhancer init skipped:", err);
    return null;
  }
}

export class DialogueEnhancerController {
  private video: HTMLVideoElement;
  private watchdogTimer: number | null = null;
  private silentStrikes = 0;
  private onUnavailable?: (reason: string) => void;

  constructor(video: HTMLVideoElement, onUnavailable?: (reason: string) => void) {
    this.video = video;
    this.onUnavailable = onUnavailable;
  }

  public sync(enabled: boolean): boolean {
    this.clearWatchdog();

    if (!enabled) {
      // Only switch existing graph back to direct bypass; never create AudioContext if unused!
      const existing = graphRegistry.get(this.video);
      if (existing && existing.mode !== "bypass") {
        try {
          existing.source.disconnect();
          existing.merger.disconnect();
          existing.analyser.disconnect();
          existing.source.connect(existing.ctx.destination);
          existing.mode = "bypass";
        } catch {}
      }
      return false;
    }

    if (!isStreamSafeForWebAudio(this.video)) {
      // Do NOT call createMediaElementSource on raw cross-origin MP4 — keep native sound intact!
      const existing = graphRegistry.get(this.video);
      if (existing && existing.mode !== "bypass") {
        try {
          existing.source.disconnect();
          existing.merger.disconnect();
          existing.analyser.disconnect();
          existing.source.connect(existing.ctx.destination);
          existing.mode = "bypass";
        } catch {}
      }
      this.onUnavailable?.("Прямий MP4 без CORS — збережено нативний звук");
      return false;
    }

    const graph = getOrCreateGraph(this.video);
    if (!graph) return false;

    if (graph.ctx.state === "suspended") {
      graph.ctx.resume().catch(() => {});
    }

    if (graph.mode !== "enhanced") {
      try {
        graph.source.disconnect();
        graph.merger.disconnect();
        graph.analyser.disconnect();

        graph.source.connect(graph.splitter);
        graph.merger.connect(graph.analyser);
        graph.analyser.connect(graph.ctx.destination);
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
        // 5 consecutive checks (2.5s) of exact digital zero while playing = broken source capture
        if (this.silentStrikes >= 5) {
          this.sync(false);
          this.onUnavailable?.("Авто-захист: відновлено нативний аудіоканал");
        }
      } else {
        // Non-zero samples confirmed — audio pipeline is healthy, stop polling!
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
    this.clearWatchdog();
    const existing = graphRegistry.get(this.video);
    if (existing && existing.mode !== "bypass") {
      try {
        existing.source.disconnect();
        existing.merger.disconnect();
        existing.analyser.disconnect();
        existing.source.connect(existing.ctx.destination);
        existing.mode = "bypass";
      } catch {}
    }
  }
}
