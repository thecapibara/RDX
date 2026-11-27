import React, { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { cn } from "../lib/utils";
import type { VideoEnhanceMode, ResolvedUpscaleMode } from "../utils/videoShaders";
import type { EffectiveLabsState } from "../services/labs";

export interface LiveFpsTelemetry {
  renderFps: number;
  streamFps: number;
}

interface StreamStatsOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  telemetryRef: React.RefObject<LiveFpsTelemetry>;
  isPlaying: boolean;
  isShaderPipelineActive: boolean;
  shaderReady: boolean;
  effectiveEnhanceMode: VideoEnhanceMode;
  resolvedUpscaleMode: ResolvedUpscaleMode;
  labs: EffectiveLabsState;
  title: string;
  isSeries: boolean;
  activeSeason?: number;
  activeEpisode?: number;
  qualityLabel: string;
  isOffline?: boolean;
  hlsRef: React.RefObject<unknown>;
  cdnHost?: string;
  cdnPingMs?: number;
  turboBufferEnabled: boolean;
  playbackSpeed: number;
  aspectRatioMode: string;
  translatorName: string;
  onClose: () => void;
}

/**
 * Isolated paint-contained Stream Diagnostics HUD (`[contain:layout_paint]`).
 * Updates its own tiny DOM subtree once every 700ms via `telemetryRef` & `videoRef`
 * WITHOUT triggering re-renders on the 5,000+ line `VideoPlayer` parent or using
 * CPU-expensive `backdrop-blur` over the 60 FPS WebGL canvas.
 */
export const StreamStatsOverlay: React.FC<StreamStatsOverlayProps> = React.memo(
  ({
    videoRef,
    telemetryRef,
    isPlaying,
    isShaderPipelineActive,
    shaderReady,
    effectiveEnhanceMode,
    resolvedUpscaleMode,
    labs,
    title,
    isSeries,
    activeSeason,
    activeEpisode,
    qualityLabel,
    isOffline,
    hlsRef,
    cdnHost,
    cdnPingMs,
    turboBufferEnabled,
    playbackSpeed,
    aspectRatioMode,
    translatorName,
    onClose,
  }) => {
    const [, setTick] = useState(0);

    useEffect(() => {
      const id = window.setInterval(() => {
        if (!document.hidden) {
          setTick((t) => (t + 1) & 0xffff);
        }
      }, 700);
      return () => window.clearInterval(id);
    }, []);

    const video = videoRef.current;
    const vw = video?.videoWidth || 0;
    const vh = video?.videoHeight || 0;
    const renderFps = telemetryRef.current?.renderFps || 0;
    const streamFps = telemetryRef.current?.streamFps || 0;

    let bufferAheadSec = 0;
    if (video && video.buffered && video.buffered.length > 0) {
      const cur = video.currentTime || 0;
      for (let i = 0; i < video.buffered.length; i++) {
        const s = video.buffered.start(i);
        const e = video.buffered.end(i);
        if (cur >= s - 1.5 && cur <= e + 0.5) {
          bufferAheadSec = Math.max(0, e - cur);
          break;
        }
      }
      if (bufferAheadSec === 0) {
        bufferAheadSec = Math.max(
          0,
          video.buffered.end(video.buffered.length - 1) - cur
        );
      }
    }

    const enhanceShort =
      effectiveEnhanceMode === "off"
        ? null
        : effectiveEnhanceMode === "deband"
        ? "Deband 2.0"
        : effectiveEnhanceMode === "cas"
        ? "CAS"
        : effectiveEnhanceMode === "cinema_hdr"
        ? "Cinema Pro 2.0"
        : "Макс (Deband+CAS)";

    const labsSummary = [
      labs.ecoActive && "🔋 Еко",
      enhanceShort,
      labs.frameBoost !== "off" &&
        (labs.frameBoost === "flow" ? "Flow 60" : "Smooth"),
      resolvedUpscaleMode !== "off" &&
        (resolvedUpscaleMode === "anime" ? "Anime4K" : "Edge-HD"),
      labs.hdrToneMap && effectiveEnhanceMode !== "cinema_hdr" && "Fake-HDR",
      labs.smartVibrance && effectiveEnhanceMode !== "cinema_hdr" && "Vibrance",
      labs.ambilight && "Ambilight",
      labs.dialogueBoost && "Діалоги",
    ]
      .filter(Boolean)
      .join(" • ");

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute top-16 left-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] bg-zinc-950/94 border border-white/15 rounded-2xl p-4.5 text-xs font-mono text-zinc-300 shadow-2xl shadow-black/80 space-y-2.5 select-none [contain:layout_paint]"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2 text-white font-bold text-xs">
            <Info className="w-4 h-4 text-rose-500" />
            <span>Статистика потоку</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2 text-[11px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Назва:</span>
            <span className="text-right truncate ml-2 max-w-[220px] text-white font-sans">
              {title}
            </span>
          </div>

          {isSeries && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500 shrink-0">Серія:</span>
              <span className="text-white font-bold font-mono">
                S{activeSeason}E{activeEpisode}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Роздільність:</span>
            <span className="text-emerald-400 font-bold font-mono">
              {vw > 0 ? `${vw}×${vh}` : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Вхід декодера:</span>
            <span className="font-mono text-zinc-300">
              {vw > 0
                ? isPlaying
                  ? `${Math.min(streamFps || 24, 30)} FPS`
                  : "Пауза"
                : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Вихід на екран:</span>
            <span
              className={cn(
                "font-bold font-mono",
                isShaderPipelineActive
                  ? shaderReady && renderFps >= 23
                    ? "text-emerald-400"
                    : "text-amber-400"
                  : streamFps >= 23
                  ? "text-emerald-400"
                  : "text-zinc-300"
              )}
            >
              {vw > 0
                ? isPlaying
                  ? isShaderPipelineActive && shaderReady
                    ? labs.frameBoost !== "off"
                      ? `${renderFps || 60} FPS ⚡ (Boost)`
                      : `${renderFps || 24} FPS (WebGL)`
                    : `${streamFps || 24} FPS (нативний)`
                  : "Пауза"
                : "—"}
            </span>
          </div>

          {labs.isActive && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500 shrink-0">RDX Labs:</span>
              <span className="text-emerald-300 font-medium text-right truncate max-w-[235px]">
                {labsSummary || "Увімкнено (очікування)"}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Якість:</span>
            <span className="text-white font-mono">{qualityLabel}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Тип потоку:</span>
            <span className="text-rose-400 truncate ml-2 font-medium">
              {isOffline
                ? "Локальний файл"
                : Boolean(hlsRef.current)
                ? "HLS Потік (MSE)"
                : "Прямий MP4 (Voidboost)"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Smart CDN:</span>
            <span
              className="text-emerald-400 font-mono font-medium truncate ml-2 max-w-[220px]"
              title={cdnHost || "Voidboost Edge"}
            >
              {cdnHost || "Voidboost Edge"} {cdnPingMs ? `(${cdnPingMs} мс)` : ""}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Turbo-буфер:</span>
            <span
              className={cn(
                "font-medium shrink-0",
                turboBufferEnabled ? "text-amber-400 font-bold" : "text-zinc-400"
              )}
            >
              {turboBufferEnabled ? "⚡ Активний (Multi-segment)" : "Вимкнено"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Буфер:</span>
            <span className="text-white font-mono">
              {vw > 0 ? `${bufferAheadSec.toFixed(1)} сек` : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Швидкість:</span>
            <span className="text-white font-mono">{playbackSpeed}x</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Пропорції:</span>
            <span className="text-white font-mono uppercase">{aspectRatioMode}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 shrink-0">Озвучка:</span>
            <span className="text-right truncate ml-2 max-w-[200px] text-white">
              {translatorName}
            </span>
          </div>
        </div>
      </div>
    );
  }
);
