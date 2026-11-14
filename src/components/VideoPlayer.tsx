import React, { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { motion } from "framer-motion";
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Minimize,
  X,
  Settings,
  Subtitles,
  SkipForward,
  SkipBack,
  ListVideo,
  Gauge,
  ChevronDown,
  PictureInPicture2,
  Tv,
  Check,
  Loader2,
  Repeat,
  Camera,
  Info,
  Timer,
  Maximize,
  ChevronRight,
  ArrowLeft,
  Crown,
  Sparkles,
  Zap,
} from "lucide-react";
import type {
  MediaDetails,
  StreamData,
  StreamQuality,
  WatchProgress,
  SeasonTab,
  EpisodeTab,
} from "../types";
import { api } from "../services/api";
import { cn } from "../lib/utils";
import { VideoEnhanceMode, VideoShaderRenderer } from "../utils/videoShaders";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { UaFlag } from "./UaFlag";

export interface ThumbnailCue {
  start: number;
  end: number;
  url: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type PlayerMode = "full" | "docked" | "os_pip";

interface VideoPlayerProps {
  details: MediaDetails;
  initialStreams: StreamData | null;
  activeTranslatorId?: string;
  activeSeason?: number;
  activeEpisode?: number;
  initialPositionSec?: number;
  mode: PlayerMode;
  onModeChange: (mode: PlayerMode) => void;
  onClose: () => void;
  onEpisodeChange?: (season: number, episode: number) => void;
  onTranslatorChange?: (translatorId: string) => void;
}

function isPremiumQuality(label?: string | null): boolean {
  if (!label) return false;
  const lower = label.toLowerCase();
  return (
    lower.includes("ultra") ||
    lower.includes("2k") ||
    lower.includes("4k") ||
    lower.includes("prem") ||
    lower.includes("2160") ||
    lower.includes("1440")
  );
}

function formatTime(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function parseVttTime(ts: string): number {
  if (!ts) return 0;
  const parts = ts.trim().split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return (parseFloat(h) || 0) * 3600 + (parseFloat(m) || 0) * 60 + (parseFloat(s) || 0);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return (parseFloat(m) || 0) * 60 + (parseFloat(s) || 0);
  }
  return 0;
}

function parseVttCues(vttContent: string, baseUrl: string): ThumbnailCue[] {
  const cues: ThumbnailCue[] = [];
  const lines = vttContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  let currentStart = -1;
  let currentEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE")) continue;

    if (line.includes("-->")) {
      const parts = line.split("-->").map((s) => s.trim().split(" ")[0]);
      if (parts.length >= 2) {
        currentStart = parseVttTime(parts[0]);
        currentEnd = parseVttTime(parts[1]);
      }
      continue;
    }

    if (currentStart >= 0 && currentEnd > currentStart) {
      let cueUrl = line;
      let x = 0;
      let y = 0;
      let w = 160;
      let h = 90;

      const hashIndex = cueUrl.indexOf("#xywh=");
      if (hashIndex !== -1) {
        const xywhStr = cueUrl.slice(hashIndex + 6);
        cueUrl = cueUrl.slice(0, hashIndex);
        const [px, py, pw, ph] = xywhStr.split(",").map((v) => parseInt(v, 10));
        if (!isNaN(px)) x = px;
        if (!isNaN(py)) y = py;
        if (!isNaN(pw)) w = pw;
        if (!isNaN(ph)) h = ph;
      }

      let fullUrl = cueUrl;
      try {
        if (!cueUrl.startsWith("http://") && !cueUrl.startsWith("https://") && !cueUrl.startsWith("data:")) {
          fullUrl = new URL(cueUrl, baseUrl).href;
        }
      } catch {}

      cues.push({
        start: currentStart,
        end: currentEnd,
        url: fullUrl,
        x,
        y,
        w,
        h,
      });

      currentStart = -1;
      currentEnd = -1;
    }
  }

  return cues;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  details,
  initialStreams,
  activeTranslatorId,
  activeSeason,
  activeEpisode,
  initialPositionSec = 0,
  mode,
  onModeChange,
  onClose,
  onEpisodeChange,
  onTranslatorChange,
}) => {
  const isMiniMode = mode === "os_pip" || mode === "docked";
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsDurationRef = useRef<number>(0);

  // Track episode change key to distinguish between quality switch and episode switch
  const currentEpisodeKey = `${activeSeason ?? 0}-${activeEpisode ?? 0}`;
  const lastEpisodeKeyRef = useRef<string>(currentEpisodeKey);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const isSeekingRef = useRef(false);
  const seekClearTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [currentTime, setCurrentTime] = useState(initialPositionSec || 0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [hudToast, setHudToast] = useState<string | null>(null);
  const hudTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Click & Double-click debounce
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stream & Quality state (start null to avoid mounting a duplicate Hls instance before fetchStream finishes)
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<StreamQuality | null>(null);
  const [preferredQualityLabel, setPreferredQualityLabel] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("rdx_preferred_quality");
      if (saved && saved.trim()) return saved;
    } catch {}
    return "720p";
  });
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>("off");
  const [loadingStream, setLoadingStream] = useState(true);

  // Sync preferred quality from backend settings if not already in localStorage
  useEffect(() => {
    try {
      if (localStorage.getItem("rdx_preferred_quality")) return;
    } catch {}
    api
      .getSettings()
      .then((s) => {
        if (
          s.preferred_quality &&
          s.preferred_quality.trim() &&
          !s.preferred_quality.toLowerCase().includes("ultra")
        ) {
          setPreferredQualityLabel(s.preferred_quality);
        }
      })
      .catch(() => {});
  }, []);

  // Menus & Controls UI
  const [showControls, setShowControls] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showTranslatorMenu, setShowTranslatorMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
  const [drawerSeason, setDrawerSeason] = useState<number>(activeSeason || 1);
  const hideControlsTimer = useRef<NodeJS.Timeout | null>(null);

  // Self-healing seasons and episodes state (matches current translator)
  const [seasons, setSeasons] = useState<SeasonTab[]>(details.seasons || []);
  const [episodes, setEpisodes] = useState<EpisodeTab[]>(details.episodes || []);

  useEffect(() => {
    if (details.seasons) setSeasons(details.seasons);
    if (details.episodes) setEpisodes(details.episodes);
  }, [details.seasons, details.episodes]);

  const isSeries = Boolean(
    (seasons && seasons.length > 0) ||
      (details.seasons && details.seasons.length > 0) ||
      activeSeason
  );

  // Sync drawer season with active season
  useEffect(() => {
    if (activeSeason) {
      setDrawerSeason(activeSeason);
    }
  }, [activeSeason]);

  // Active Translator
  const currentTranslator =
    details.translators.find((t) => t.id === activeTranslatorId) ||
    details.translators.find((t) => t.is_active) ||
    details.translators[0];

  const effectiveTranslatorId = currentTranslator?.id || activeTranslatorId;
  const currentStreamTargetKey = `${effectiveTranslatorId || ""}:${currentEpisodeKey}`;
  const [loadedStreamKey, setLoadedStreamKey] = useState<string>("");
  const [isStreamFetching, setIsStreamFetching] = useState<boolean>(true);
  const streamRequestIdRef = useRef<number>(0);
  const isInitialMountRef = useRef<boolean>(true);
  const loadedEpisodeKeyRef = useRef<string>("");
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const pipDragStartRef = useRef<{ x: number; y: number; isDown: boolean } | null>(null);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      pipDragStartRef.current = null;
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // Self-heal seasons & episodes if missing or translator changed
  useEffect(() => {
    if (!isSeries || !currentTranslator?.id) return;

    const currentSeasonEps = episodes.filter(
      (ep) => ep.season_id === String(activeSeason || 1)
    );

    // If current season has 0 episodes in our local list, fetch from API for this translator!
    if (currentSeasonEps.length === 0 || seasons.length === 0) {
      let isCancelled = false;
      api
        .getEpisodes(details.id, currentTranslator.id, details.url)
        .then((data) => {
          if (isCancelled) return;
          if (data.episodes && data.episodes.length > 0) {
            setEpisodes(data.episodes);
            if (data.seasons && data.seasons.length > 0) {
              setSeasons(data.seasons);
            }
          }
        })
        .catch((err) => {
          console.warn("Self-healing getEpisodes failed:", err);
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [details.id, details.url, isSeries, currentTranslator?.id, activeSeason]);

  // Show HUD toast helper
  const showHud = (text: string) => {
    setHudToast(text);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setHudToast(null), 1200);
  };

  // Mini-player seek ripple animation state
  const [miniSeekRipple, setMiniSeekRipple] = useState<"left" | "right" | null>(null);
  const miniRippleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerMiniSeekRipple = (side: "left" | "right") => {
    setMiniSeekRipple(side);
    if (miniRippleTimerRef.current) clearTimeout(miniRippleTimerRef.current);
    miniRippleTimerRef.current = setTimeout(() => setMiniSeekRipple(null), 500);
  };

  // Mini-player controls auto-hide state & timer
  const [miniControlsVisible, setMiniControlsVisible] = useState(false);
  const miniHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMiniMouseMove = useCallback(() => {
    setMiniControlsVisible(true);
    if (miniHideTimerRef.current) clearTimeout(miniHideTimerRef.current);
    if (isPlaying) {
      miniHideTimerRef.current = setTimeout(() => {
        setMiniControlsVisible(false);
      }, 2500);
    }
  }, [isPlaying]);

  const handleMiniMouseLeave = useCallback(() => {
    if (miniHideTimerRef.current) clearTimeout(miniHideTimerRef.current);
    setMiniControlsVisible(false);
  }, []);

  // Vayou-inspired Features: Aspect Ratio, A-B Loop, Screenshot, Sleep Timer, Media Info
  const [aspectRatioMode, setAspectRatioMode] = useState<
    "auto" | "cover" | "fill" | "16:9" | "21:9" | "4:3"
  >("auto");
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [showRemainingTime, setShowRemainingTime] = useState(false);
  const [showMediaInfo, setShowMediaInfo] = useState(false);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepTimerSecondsLeft, setSleepTimerSecondsLeft] = useState<number | null>(null);

  // Custom Smooth SeekBar state
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  // Custom Context Menu & Settings state
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    page: "main" | "translators" | "episodes" | "quality" | "speed" | "aspect" | "sleep" | "subtitles" | "boost" | "enhance";
  } | null>(null);

  // 1. True Fullscreen State & Sync
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  isFullscreenRef.current = isFullscreen;
  const lastDblClickTimeRef = useRef<number>(0);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);

    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      getCurrentWindow()
        .isFullscreen()
        .then(setIsFullscreen)
        .catch(() => {});
    }

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  const toggleFullscreen = useCallback(
    async (forceState?: boolean) => {
      const target = typeof forceState === "boolean" ? forceState : !isFullscreen;
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          await api.setFullscreenMode(target);
          setIsFullscreen(target);
        } catch (err) {
          console.warn("Tauri setFullscreenMode error:", err);
          setIsFullscreen(target);
        }
      } else {
        if (!target && typeof document !== "undefined" && document.fullscreenElement) {
          try {
            await document.exitFullscreen?.();
          } catch {}
        }
        setIsFullscreen(target);
      }
      showHud(target ? "⛶ Повний екран" : "❐ У вікні");
    },
    [isFullscreen]
  );

  // 2. Next Episode Autoplay Countdown & Settings
  const [autoplayNext, setAutoplayNext] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rdx_autoplay_next") !== "false";
    } catch {
      return true;
    }
  });
  const [nextEpDismissed, setNextEpDismissed] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        if (typeof (s as any).autoplay_next === "boolean") {
          setAutoplayNext((s as any).autoplay_next);
          try {
            localStorage.setItem("rdx_autoplay_next", String((s as any).autoplay_next));
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setNextEpDismissed(false);
  }, [activeSeason, activeEpisode]);

  const getNextEpisodeTarget = useCallback((): {
    season: number;
    episode: number;
    isNewSeason: boolean;
  } | null => {
    if (!isSeries || !activeSeason || !activeEpisode) return null;

    const currentSeasonEps = episodes.filter(
      (ep) => ep.season_id === String(activeSeason)
    );
    const nextInCurSeason = currentSeasonEps.find(
      (ep) => parseInt(ep.episode_id, 10) === activeEpisode + 1
    );
    if (nextInCurSeason) {
      return {
        season: activeSeason,
        episode: activeEpisode + 1,
        isNewSeason: false,
      };
    }

    const nextSeason = activeSeason + 1;
    const nextSeasonEps = episodes.filter(
      (ep) => ep.season_id === String(nextSeason)
    );
    if (nextSeasonEps.length > 0) {
      const firstEp = parseInt(nextSeasonEps[0].episode_id, 10) || 1;
      return {
        season: nextSeason,
        episode: firstEp,
        isNewSeason: true,
      };
    }

    return null;
  }, [isSeries, activeSeason, activeEpisode, episodes]);

  // 3. Per-Episode Progress Map
  const [episodeProgressMap, setEpisodeProgressMap] = useState<
    Record<string, { position_sec: number; duration_sec: number }>
  >({});

  useEffect(() => {
    try {
      const local = localStorage.getItem(`rdx_episode_progress_${details.id}`);
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && typeof parsed === "object") {
          setEpisodeProgressMap(parsed);
        }
      }
    } catch {}

    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const fetchProgress: Promise<any[]> = (api as any).getEpisodeProgress
        ? (api as any).getEpisodeProgress(details.id)
        : invoke("get_episode_progress", { mediaId: details.id });

      fetchProgress
        .then((list) => {
          if (Array.isArray(list)) {
            setEpisodeProgressMap((prev) => {
              const next = { ...prev };
              for (const p of list) {
                if (p && p.season != null && p.episode != null) {
                  next[`${p.season}-${p.episode}`] = {
                    position_sec: p.position_sec,
                    duration_sec: p.duration_sec,
                  };
                }
              }
              try {
                localStorage.setItem(`rdx_episode_progress_${details.id}`, JSON.stringify(next));
              } catch {}
              return next;
            });
          }
        })
        .catch(() => {});
    }
  }, [details.id]);

  // 4. Timeline Scrubbing Thumbnails
  const [thumbnailCues, setThumbnailCues] = useState<ThumbnailCue[]>([]);

  useEffect(() => {
    if (!streamData?.thumbnails) {
      setThumbnailCues([]);
      return;
    }

    const thumbUrl = streamData.thumbnails;
    let isCancelled = false;

    fetch(thumbUrl)
      .then((r) => r.text())
      .then((text) => {
        if (isCancelled) return;
        const cues = parseVttCues(text, thumbUrl);
        setThumbnailCues(cues);
      })
      .catch((err) => {
        console.warn("Failed to load timeline thumbnails VTT:", err);
        if (!isCancelled) setThumbnailCues([]);
      });

    return () => {
      isCancelled = true;
    };
  }, [streamData?.thumbnails]);

  // Clear any legacy broken audio/night-mode flags from previous sessions
  useEffect(() => {
    try {
      localStorage.removeItem("rdx_night_mode");
    } catch {}
  }, []);

  // 6. Video Enhancement (High-Performance Zero-Leak Deband & CAS Sharpening)
  const [turboBufferEnabled, setTurboBufferEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rdx_turbo_buffer") !== "false";
    } catch {
      return true;
    }
  });
  const [videoEnhanceMode, setVideoEnhanceMode] = useState<VideoEnhanceMode>(() => {
    try {
      return (localStorage.getItem("rdx_video_enhance") as VideoEnhanceMode) || "off";
    } catch {
      return "off";
    }
  });
  const [shaderReady, setShaderReady] = useState(false);
  const [renderFps, setRenderFps] = useState<number>(0);
  const [streamFps, setStreamFps] = useState<number>(0);
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shaderRendererRef = useRef<VideoShaderRenderer | null>(null);

  const handleSelectEnhanceMode = useCallback((mode: VideoEnhanceMode) => {
    setVideoEnhanceMode(mode);
    setShaderReady(false);
    try {
      localStorage.setItem("rdx_video_enhance", mode);
    } catch {}

    const labels: Record<VideoEnhanceMode, string> = {
      off: "Покращення: Вимкнено",
      deband: "Покращення: Згладжування (Deband)",
      cas: "Покращення: Чіткість (CAS)",
      max: "Покращення: Максимальне (Deband + CAS)",
    };
    showHud(`✨ ${labels[mode]}`);
  }, []);

  useEffect(() => {
    if (videoEnhanceMode === "off") {
      shaderRendererRef.current?.stop();
      setShaderReady(false);
      return;
    }

    if (!shaderCanvasRef.current || !videoRef.current) return;

    if (
      shaderRendererRef.current &&
      shaderRendererRef.current.version !== VideoShaderRenderer.VERSION
    ) {
      shaderRendererRef.current.destroy();
      shaderRendererRef.current = null;
    }

    if (!shaderRendererRef.current) {
      shaderRendererRef.current = new VideoShaderRenderer(
        shaderCanvasRef.current,
        videoRef.current,
        {
          onFrameSuccess: () => setShaderReady(true),
          onFrameError: () => setShaderReady(false),
          onFpsUpdate: (fps) =>
            setRenderFps((prev) => (prev === fps ? prev : fps)),
        }
      );
    }

    shaderRendererRef.current.setMode(videoEnhanceMode);
    shaderRendererRef.current.start();
  }, [videoEnhanceMode, streamData]);

  // Real-time video decoder framerate monitor for Stream Info overlay when shaders are off
  useEffect(() => {
    if (!showMediaInfo || videoEnhanceMode !== "off") return;

    let frameCount = 0;
    let lastTime = performance.now();
    let animId: number | null = null;

    const measureFps = () => {
      frameCount++;
      const now = performance.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.8) {
        const nextFps = Math.round(frameCount / elapsed);
        setStreamFps((prev) => (prev === nextFps ? prev : nextFps));
        frameCount = 0;
        lastTime = now;
      }
      animId = requestAnimationFrame(measureFps);
    };

    animId = requestAnimationFrame(measureFps);

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [showMediaInfo, isPlaying, videoEnhanceMode]);

  useEffect(() => {
    return () => {
      shaderRendererRef.current?.destroy();
      shaderRendererRef.current = null;
    };
  }, [details.id, activeSeason, activeEpisode]);

  const [subFontSize, setSubFontSize] = useState<"sm" | "md" | "lg" | "xl">("md");
  const [subBgOpacity, setSubBgOpacity] = useState<number>(60);
  const [subOffsetSec, setSubOffsetSec] = useState<number>(0);

  const adjustSubtitleOffset = (deltaSec: number) => {
    const nextOffset = Math.round((subOffsetSec + deltaSec) * 10) / 10;
    setSubOffsetSec(nextOffset);

    const tracks = videoRef.current?.textTracks;
    if (tracks && tracks.length > 0) {
      for (let i = 0; i < tracks.length; i++) {
        const cues = tracks[i].cues;
        if (cues) {
          for (let j = 0; j < cues.length; j++) {
            const cue = cues[j];
            cue.startTime += deltaSec;
            cue.endTime += deltaSec;
          }
        }
      }
    }

    showHud(`Субтитри: ${nextOffset >= 0 ? "+" : ""}${nextOffset.toFixed(1)} сек`);
  };

  // Sleep Timer countdown effect (interval created once per timer activation)
  const isSleepTimerActive = sleepTimerSecondsLeft !== null;
  useEffect(() => {
    if (!isSleepTimerActive) return;
    const interval = setInterval(() => {
      setSleepTimerSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (videoRef.current) {
            videoRef.current.pause();
          }
          showHud("😴 Таймер сну: плеєр зупинено");
          setSleepTimerMinutes(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isSleepTimerActive]);

  const setSleepTimer = (mins: number | null) => {
    if (mins === null || mins <= 0) {
      setSleepTimerMinutes(null);
      setSleepTimerSecondsLeft(null);
      showHud("Таймер сну вимкнено");
    } else {
      setSleepTimerMinutes(mins);
      setSleepTimerSecondsLeft(mins * 60);
      showHud(`Таймер сну: ${mins} хв`);
    }
  };

  const formatSleepTime = (secs: number | null): string => {
    if (secs === null) return "";
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Cycle A-B Loop (A -> B -> Clear)
  const handleCycleAbLoop = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    if (loopA === null) {
      setLoopA(cur);
      showHud(`🔁 Точка A: ${formatTime(cur)}`);
    } else if (loopB === null) {
      if (cur > loopA) {
        setLoopB(cur);
        showHud(`🔁 Цикл A–B: ${formatTime(loopA)} ➔ ${formatTime(cur)}`);
      } else {
        setLoopB(loopA);
        setLoopA(cur);
        showHud(`🔁 Цикл A–B: ${formatTime(cur)} ➔ ${formatTime(loopA)}`);
      }
    } else {
      setLoopA(null);
      setLoopB(null);
      showHud("🔁 Цикл A–B вимкнено");
    }
  };

  // Frame screenshot capture
  const handleScreenshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      const cleanTitle = details.title.replace(/[^\w\sа-яіїєґА-ЯІЇЄҐ-]/gi, "").trim();
      a.download = `rdx-${cleanTitle || "screenshot"}-${formatTime(currentTime).replace(/:/g, "-")}.png`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showHud("📸 Скріншот збережено");
    } catch (err) {
      console.warn("Screenshot capture error:", err);
      showHud("⚠️ Помилка створення скріншоту");
    }
  };

  const getVideoStyle = (): React.CSSProperties => {
    const style: React.CSSProperties = {};
    if (aspectRatioMode === "16:9") {
      style.aspectRatio = "16 / 9";
      style.objectFit = "fill";
      style.width = "100%";
      style.maxHeight = "100%";
    } else if (aspectRatioMode === "21:9") {
      style.aspectRatio = "21 / 9";
      style.objectFit = "fill";
      style.width = "100%";
      style.maxHeight = "100%";
    } else if (aspectRatioMode === "4:3") {
      style.aspectRatio = "4 / 3";
      style.objectFit = "fill";
      style.width = "auto";
      style.height = "100%";
      style.maxWidth = "100%";
    }
    return style;
  };

  const getVideoObjectFitClass = (): string => {
    if (mode === "docked") return "object-cover";
    if (aspectRatioMode === "cover") return "object-cover";
    if (aspectRatioMode === "fill") return "object-fill";
    if (aspectRatioMode === "16:9" || aspectRatioMode === "21:9" || aspectRatioMode === "4:3") return "";
    return "object-contain";
  };

  // Effective finite duration helper (MSE can initially report Infinity or NaN on video.duration)
  const getEffectiveDuration = useCallback((): number => {
    if (Number.isFinite(duration) && duration > 0) return duration;
    const vidDur = videoRef.current?.duration ?? 0;
    if (Number.isFinite(vidDur) && vidDur > 0) return vidDur;
    if (Number.isFinite(hlsDurationRef.current) && hlsDurationRef.current > 0) {
      return hlsDurationRef.current;
    }
    const epKey = `${activeSeason ?? 1}-${activeEpisode ?? 1}`;
    const savedEp = episodeProgressMap[epKey];
    if (savedEp && Number.isFinite(savedEp.duration_sec) && savedEp.duration_sec > 0) {
      return savedEp.duration_sec;
    }
    return 0;
  }, [duration, activeSeason, activeEpisode, episodeProgressMap]);

  const syncDurationFromVideo = useCallback(() => {
    const vidDur = videoRef.current?.duration ?? 0;
    if (Number.isFinite(vidDur) && vidDur > 0) {
      setDuration(vidDur);
    } else if (Number.isFinite(hlsDurationRef.current) && hlsDurationRef.current > 0) {
      setDuration(hlsDurationRef.current);
    }
  }, []);

  const commitSeekToVideo = useCallback(
    (targetSec: number) => {
      if (!Number.isFinite(targetSec)) return;
      const effDur = getEffectiveDuration();
      const clamped =
        effDur > 0 ? Math.max(0, Math.min(effDur, targetSec)) : Math.max(0, targetSec);
      if (videoRef.current) {
        try {
          isSeekingRef.current = true;
          setIsSeeking(true);
          if (seekClearTimeoutRef.current) clearTimeout(seekClearTimeoutRef.current);
          seekClearTimeoutRef.current = setTimeout(() => {
            isSeekingRef.current = false;
            setIsSeeking(false);
          }, 400);
          videoRef.current.currentTime = clamped;
        } catch (err) {
          console.warn("Seek failed:", err);
        }
      }
      setCurrentTime(clamped);
    },
    [getEffectiveDuration]
  );

  const calcTimeFromEvent = useCallback(
    (clientX: number): number => {
      const effDur = getEffectiveDuration();
      if (!seekBarRef.current || effDur <= 0) return 0;
      const rect = seekBarRef.current.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return fraction * effDur;
    },
    [getEffectiveDuration]
  );

  const lastDragSeekCommitRef = useRef<number>(0);

  const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setIsDraggingSeek(true);
    const target = calcTimeFromEvent(e.clientX);
    lastDragSeekCommitRef.current = performance.now();
    commitSeekToVideo(target);
  };

  const handleSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const effDur = getEffectiveDuration();
    if (!seekBarRef.current || effDur <= 0) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const hoveredTarget = (x / rect.width) * effDur;
    setHoverX(x);
    setHoverTime(hoveredTarget);

    if (isDraggingSeek) {
      setCurrentTime(hoveredTarget);
      // Throttle live video.currentTime updates during drag to avoid flooding MSE/GStreamer
      const now = performance.now();
      if (now - lastDragSeekCommitRef.current > 180) {
        lastDragSeekCommitRef.current = now;
        commitSeekToVideo(hoveredTarget);
      }
    }
  };

  const handleSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSeek) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    setIsDraggingSeek(false);
    const target = calcTimeFromEvent(e.clientX);
    commitSeekToVideo(target);
  };

  const handleSeekPointerLeave = () => {
    if (!isDraggingSeek) {
      setHoverTime(null);
    }
  };

  const getBufferedEnd = useCallback((): number => {
    if (!videoRef.current) return 0;
    const b = videoRef.current.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= currentTime && currentTime <= b.end(i)) {
        return b.end(i);
      }
    }
    return b.length > 0 ? b.end(b.length - 1) : 0;
  }, [currentTime]);

  const effectiveDur = getEffectiveDuration();
  const bufferedPct =
    effectiveDur > 0 ? Math.min(100, (getBufferedEnd() / effectiveDur) * 100) : 0;
  const playedPct =
    effectiveDur > 0 ? Math.min(100, (currentTime / effectiveDur) * 100) : 0;

  const nextEpTarget = getNextEpisodeTarget();
  const remainingSec = effectiveDur > 0 ? Math.max(0, effectiveDur - currentTime) : 0;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Disable heavy player context menu in mini-player (PiP / docked)
    if (isMiniMode) {
      return;
    }

    const pad = 12;
    const menuWidth = 260;
    const menuHeight = 380;
    let left = e.clientX + menuWidth > window.innerWidth ? e.clientX - menuWidth : e.clientX;
    let top = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY;
    left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - menuHeight - pad));

    setContextMenu({
      open: true,
      x: left,
      y: top,
      page: "main",
    });
  };

  const handleToggleSettingsMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (contextMenu?.open) {
      setContextMenu(null);
      return;
    }
    const rect = settingsBtnRef.current?.getBoundingClientRect();
    const menuWidth = 260;
    const pad = 16;
    const x = rect
      ? Math.max(pad, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - pad))
      : window.innerWidth - menuWidth - pad;
    const y = rect ? rect.bottom + 10 : 70;

    setShowQualityMenu(false);
    setShowTranslatorMenu(false);
    setShowSubtitleMenu(false);
    setShowSpeedMenu(false);

    setContextMenu({
      open: true,
      x,
      y,
      page: "main",
    });
  };

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu?.open) return;
    const onWindowClick = () => setContextMenu(null);
    window.addEventListener("click", onWindowClick);
    return () => window.removeEventListener("click", onWindowClick);
  }, [contextMenu?.open]);

  // Fetch authoritative stream for active translator/season/episode with race condition protection
  useEffect(() => {
    let isCancelled = false;
    const reqId = ++streamRequestIdRef.current;

    const fetchStream = async () => {
      setLoadingStream(true);
      setIsStreamFetching(true);
      // Reset A-B loop when switching series/audio
      setLoopA(null);
      setLoopB(null);

      try {
        let data: StreamData | null = null;
        if (details.is_offline) {
          const allDownloads = await api.getDownloads();
          const target =
            allDownloads.find(
              (d) =>
                d.media_id === details.id &&
                d.status === "completed" &&
                (!effectiveTranslatorId || d.translator_id === effectiveTranslatorId) &&
                (!isSeries || ((d.season ?? 1) === (activeSeason || 1) && (d.episode ?? 1) === (activeEpisode || 1)))
            ) ||
            allDownloads.find(
              (d) =>
                d.media_id === details.id &&
                d.status === "completed" &&
                (!isSeries || ((d.season ?? 1) === (activeSeason || 1) && (d.episode ?? 1) === (activeEpisode || 1)))
            );

          if (target) {
            data = {
              qualities: [
                {
                  label: target.quality || "1080p",
                  hls_url: null,
                  mp4_url: convertFileSrc(target.file_path),
                },
              ],
              subtitles: [],
              default_quality: target.quality || "1080p",
              thumbnails: null,
            };
          }
        } else {
          data = await api.getStream(
            details.id,
            details.url,
            isSeries,
            effectiveTranslatorId,
            isSeries ? activeSeason || 1 : undefined,
            isSeries ? activeEpisode || 1 : undefined
          );
        }

        if (isCancelled || reqId !== streamRequestIdRef.current) {
          return;
        }

        if (data && data.qualities && data.qualities.length > 0) {
          setStreamData(data);
          setLoadedStreamKey(currentStreamTargetKey);
          loadedEpisodeKeyRef.current = currentEpisodeKey;
        } else if (
          isInitialMountRef.current &&
          initialStreams &&
          initialStreams.qualities.length > 0
        ) {
          // Only fallback to initialStreams on the very first mount if current translator/episode match initial
          setStreamData(initialStreams);
          setLoadedStreamKey(currentStreamTargetKey);
          loadedEpisodeKeyRef.current = currentEpisodeKey;
        } else {
          showHud("⚠️ Відеопотік недоступний для цієї серії/озвучки");
        }
      } catch (err) {
        if (isCancelled || reqId !== streamRequestIdRef.current) return;
        console.warn("Failed to fetch stream data:", err);
        if (
          isInitialMountRef.current &&
          initialStreams &&
          initialStreams.qualities.length > 0
        ) {
          setStreamData(initialStreams);
          setLoadedStreamKey(currentStreamTargetKey);
          loadedEpisodeKeyRef.current = currentEpisodeKey;
        } else {
          showHud("⚠️ Помилка завантаження відеопотоку");
        }
      } finally {
        if (!isCancelled && reqId === streamRequestIdRef.current) {
          setLoadingStream(false);
          setIsStreamFetching(false);
          isInitialMountRef.current = false;
        }
      }
    };

    fetchStream();
    return () => {
      isCancelled = true;
    };
  }, [
    details.id,
    details.url,
    isSeries,
    effectiveTranslatorId,
    activeSeason,
    activeEpisode,
    currentStreamTargetKey,
    currentEpisodeKey,
    initialStreams,
  ]);

  // When streamData arrives, pick user's saved quality (or default 720p, avoiding Premium-only 1080p Ultra unless explicitly chosen)
  useEffect(() => {
    if (!streamData || streamData.qualities.length === 0) return;

    const targetLabel = selectedQuality?.label || preferredQualityLabel || "720p";

    const preferred =
      streamData.qualities.find((q) => q.label === targetLabel) ||
      streamData.qualities.find((q) => q.label === "720p") ||
      streamData.qualities.find((q) => q.label === "1080p") ||
      streamData.qualities.find((q) => q.label === "480p") ||
      streamData.qualities.find(
        (q) =>
          q.label === streamData.default_quality &&
          !q.label.toLowerCase().includes("ultra")
      ) ||
      streamData.qualities.find((q) => !q.label.toLowerCase().includes("ultra")) ||
      streamData.qualities[0];

    setSelectedQuality(preferred);
  }, [streamData, preferredQualityLabel]);

  // Attach stream to video
  useEffect(() => {
    if (!selectedQuality || !videoRef.current) return;

    // Guard against attaching old stream quality while switching episode/translator
    if (
      isStreamFetching ||
      loadedStreamKey !== currentStreamTargetKey ||
      !streamData?.qualities.some((q) => q.label === selectedQuality.label)
    ) {
      return;
    }

    const video = videoRef.current;

    // Distinguish between quality switch and episode switch
    const isEpisodeChange = currentEpisodeKey !== lastEpisodeKeyRef.current;
    if (isEpisodeChange) {
      lastEpisodeKeyRef.current = currentEpisodeKey;
      hlsDurationRef.current = 0;
      setDuration(0);
      setCurrentTime(initialPositionSec || 0);
      setLoopA(null);
      setLoopB(null);
    }

    const prevTime = isEpisodeChange
      ? initialPositionSec
      : video.currentTime > 0
      ? video.currentTime
      : initialPositionSec;

    const startMp4 = (mp4Url: string) => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = mp4Url;
      const onMetadata = () => {
        const vidDur = video.duration;
        if (Number.isFinite(vidDur) && vidDur > 0) {
          hlsDurationRef.current = vidDur;
          setDuration(vidDur);
        }
        if (prevTime > 0 && (!Number.isFinite(vidDur) || vidDur <= 0 || prevTime < vidDur - 5)) {
          video.currentTime = prevTime;
          setCurrentTime(prevTime);
          if (initialPositionSec > 0 && prevTime === initialPositionSec) {
            setResumeNotice(`Відновлено з ${formatTime(initialPositionSec)}`);
            setTimeout(() => setResumeNotice(null), 3500);
          }
        }
        video.playbackRate = playbackSpeed;
        video.play().catch(() => {});
      };
      const onError = () => {
        if (selectedQuality.hls_url && video.src !== selectedQuality.hls_url) {
          console.warn("Direct MP4 stream error, falling back to HLS stream:", selectedQuality.hls_url);
          startHls(selectedQuality.hls_url);
        }
      };
      video.addEventListener("loadedmetadata", onMetadata, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.playbackRate = playbackSpeed;
      video.play().catch(() => {});
    };

    // Helper to start HLS playback with native startPosition and LEVEL_LOADED duration capture
    const startHls = (hlsUrl: string) => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (Hls.isSupported()) {
        let mediaErrorRecovered = false;
        let networkErrorRetries = 0;
        let hlsWatchdogTimer: NodeJS.Timeout | null = setTimeout(() => {
          if (hlsRef.current && (!hlsDurationRef.current || hlsDurationRef.current <= 0) && selectedQuality.mp4_url) {
            console.warn("HLS manifest/level timed out after 6s, falling back to direct MP4");
            hls.destroy();
            hlsRef.current = null;
            startMp4(selectedQuality.mp4_url);
          }
        }, 6000);

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          startPosition: prevTime > 0 ? prevTime : -1,
          maxBufferLength: turboBufferEnabled ? 300 : 60,
          maxMaxBufferLength: turboBufferEnabled ? 600 : 120,
          backBufferLength: turboBufferEnabled ? 120 : 60,
          progressive: true,
          maxBufferHole: 1.2,
          highBufferWatchdogPeriod: 1,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 10,
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
          if (hlsWatchdogTimer) {
            clearTimeout(hlsWatchdogTimer);
            hlsWatchdogTimer = null;
          }
          const totalDur = data.details?.totalduration;
          if (totalDur && Number.isFinite(totalDur) && totalDur > 0) {
            hlsDurationRef.current = totalDur;
            setDuration(totalDur);
            // If startPosition exceeded actual duration (e.g. demo stream), reset to 0
            if (video.currentTime > totalDur - 3) {
              video.currentTime = 0;
              setCurrentTime(0);
            }
          }
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (hlsWatchdogTimer) {
            clearTimeout(hlsWatchdogTimer);
            hlsWatchdogTimer = null;
          }
          if (prevTime > 0) {
            setCurrentTime(prevTime);
            if (initialPositionSec > 0 && prevTime === initialPositionSec) {
              setResumeNotice(`Відновлено з ${formatTime(initialPositionSec)}`);
              setTimeout(() => setResumeNotice(null), 3500);
            }
          }
          video.playbackRate = playbackSpeed;
          video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.warn("HLS fatal error:", data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (
                  networkErrorRetries < 1 &&
                  data.details !== Hls.ErrorDetails.MANIFEST_LOAD_ERROR &&
                  data.details !== Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT &&
                  data.details !== Hls.ErrorDetails.LEVEL_LOAD_ERROR &&
                  data.details !== Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT
                ) {
                  networkErrorRetries++;
                  hls.startLoad();
                } else if (selectedQuality.mp4_url) {
                  console.info("HLS network error, falling back to MP4 stream");
                  hls.destroy();
                  hlsRef.current = null;
                  startMp4(selectedQuality.mp4_url);
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (!mediaErrorRecovered) {
                  mediaErrorRecovered = true;
                  hls.recoverMediaError();
                } else {
                  hls.destroy();
                  hlsRef.current = null;
                  if (selectedQuality.mp4_url) {
                    console.info("HLS media error, falling back to MP4 stream");
                    startMp4(selectedQuality.mp4_url);
                  }
                }
                break;
              default:
                hls.destroy();
                hlsRef.current = null;
                if (selectedQuality.mp4_url) {
                  console.info("HLS fatal error, falling back to MP4 stream");
                  startMp4(selectedQuality.mp4_url);
                }
                break;
            }
          }
        });
      } else {
        // Native HLS support (Safari / macOS WKWebView / iOS)
        startMp4(hlsUrl);
      }
    };

    // Clean up previous HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (selectedQuality.hls_url) {
      startHls(selectedQuality.hls_url);
    } else if (selectedQuality.mp4_url) {
      startMp4(selectedQuality.mp4_url);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [
    selectedQuality,
    currentEpisodeKey,
    loadedStreamKey,
    currentStreamTargetKey,
    isStreamFetching,
    streamData,
    initialPositionSec,
    playbackSpeed,
  ]);

  // Auto-save watch progress every 5 seconds & on unmount
  const saveCurrentProgress = useCallback(() => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    const dur = getEffectiveDuration();
    if (!Number.isFinite(time) || time < 2 || !Number.isFinite(dur) || dur <= 0) return;

    const posSec = Math.floor(time);
    const durSec = Math.floor(dur);

    if (isSeries && activeSeason && activeEpisode) {
      setEpisodeProgressMap((prev) => {
        const next = {
          ...prev,
          [`${activeSeason}-${activeEpisode}`]: {
            position_sec: posSec,
            duration_sec: durSec,
          },
        };
        try {
          localStorage.setItem(`rdx_episode_progress_${details.id}`, JSON.stringify(next));
        } catch {}
        return next;
      });
    }

    const progress: WatchProgress = {
      media_id: details.id,
      media_url: details.url,
      title: details.title,
      orig_title: details.orig_title,
      poster_url: details.poster,
      media_type: isSeries ? "series" : "movie",
      translator_id: currentTranslator?.id || null,
      translator_name: currentTranslator?.name || null,
      season: isSeries ? activeSeason || 1 : null,
      episode: isSeries ? activeEpisode || 1 : null,
      position_sec: posSec,
      duration_sec: durSec,
      updated_at: Math.floor(Date.now() / 1000),
    };

    api.saveWatchProgress(progress).catch((e) =>
      console.warn("Failed to auto-save progress:", e)
    );
  }, [details, currentTranslator, isSeries, activeSeason, activeEpisode, getEffectiveDuration]);

  useEffect(() => {
    const interval = setInterval(saveCurrentProgress, 5000);
    return () => {
      clearInterval(interval);
      saveCurrentProgress();
    };
  }, [saveCurrentProgress]);

  // References to keep MPRIS in sync without recreating listeners
  const lastMprisSyncRef = useRef<number>(0);
  const lastMediaSessionKeyRef = useRef<string>("");

  const syncMprisState = useCallback(
    (force = false, overridePlaying?: boolean, overrideTime?: number) => {
      if (!details.title) return;
      const now = performance.now();
      // Throttle continuous position updates to once per 1000ms unless forced
      if (!force && now - lastMprisSyncRef.current < 1000) {
        return;
      }
      lastMprisSyncRef.current = now;

      const artist = isSeries
        ? `Сезон ${activeSeason || 1}, Серія ${activeEpisode || 1}`
        : (details.orig_title || "RDX");
      const album = currentTranslator?.name
        ? `Озвучка: ${currentTranslator.name}`
        : (details.orig_title || "RDX");

      const effDur = getEffectiveDuration();
      const liveTime = videoRef.current?.currentTime ?? 0;
      const currentPos = overrideTime !== undefined ? overrideTime : liveTime;
      const playing = overridePlaying !== undefined ? overridePlaying : isPlaying;

      // Sync WebKitGTK MediaSession metadata so its built-in MPRIS never falls back to "localhost"
      if (typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession) {
        try {
          const metaKey = `${details.title}|${artist}|${album}|${details.poster || ""}`;
          if (lastMediaSessionKeyRef.current !== metaKey) {
            lastMediaSessionKeyRef.current = metaKey;
            navigator.mediaSession.metadata = new MediaMetadata({
              title: details.title,
              artist,
              album,
              artwork: details.poster ? [{ src: details.poster }] : [],
            });
          }
          navigator.mediaSession.playbackState = playing ? "playing" : "paused";
        } catch {}
      }

      api
        .updateMprisState({
          title: details.title,
          artist,
          album,
          poster: details.poster,
          durationSec: effDur > 0 ? effDur : undefined,
          positionSec: currentPos >= 0 ? currentPos : undefined,
          isPlaying: playing,
        })
        .catch(() => {});
    },
    [
      details.title,
      details.orig_title,
      details.poster,
      isSeries,
      activeSeason,
      activeEpisode,
      currentTranslator?.name,
      isPlaying,
      getEffectiveDuration,
    ]
  );

  // Sync MPRIS when track / episode / translator / play state changes
  useEffect(() => {
    syncMprisState(true);
  }, [
    details.title,
    details.orig_title,
    details.poster,
    isSeries,
    activeSeason,
    activeEpisode,
    currentTranslator?.name,
    isPlaying,
    syncMprisState,
  ]);

  // Comprehensive player teardown and close (pauses video, unloads sources, clears MPRIS)
  const handleTeardownAndClose = useCallback(() => {
    // If fullscreen, restore normal window state
    if (isFullscreen || isFullscreenRef.current || (typeof document !== "undefined" && Boolean(document.fullscreenElement))) {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        api.setFullscreenMode(false).catch(() => {});
      } else if (typeof document !== "undefined" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
      isFullscreenRef.current = false;
    }

    // If player was in OS PiP mode, restore normal window size so it doesn't get stuck in 520x292
    if (mode === "os_pip" || modeRef.current === "os_pip") {
      api.setMiniPlayerMode(false).catch(() => {});
    }

    document.title = "";

    // 0. Instantly clear webview mediaSession so WebKit drops its MPRIS player
    if (typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch {}
    }

    // Instantly remove player card from Linux / OS system shade
    api.clearMprisState().catch(() => {});

    // 1. Auto-save current watch progress
    saveCurrentProgress();

    // 2. Pause video and unload source to kill WebKit GStreamer pipeline
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}
    }

    // 3. Destroy HLS instance
    if (hlsRef.current) {
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
        hlsRef.current = null;
      } catch {}
    }

    // 4. Fire parent onClose
    onClose();
  }, [mode, isFullscreen, saveCurrentProgress, onClose]);

  // Teardown Lifecycle on unmount
  useEffect(() => {
    return () => {
      if (typeof document !== "undefined" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      if (isFullscreenRef.current && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        api.setFullscreenMode(false).catch(() => {});
      }

      // If player was in OS PiP mode, restore normal window size
      if (modeRef.current === "os_pip") {
        api.setMiniPlayerMode(false).catch(() => {});
      }

      document.title = "";
      if (typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession) {
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = "none";
        } catch {}
      }
      api.clearMprisState().catch(() => {});

      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
          video.removeAttribute("src");
          video.load();
        } catch {}
      }

      if (hlsRef.current) {
        try {
          hlsRef.current.stopLoad();
          hlsRef.current.detachMedia();
          hlsRef.current.destroy();
          hlsRef.current = null;
        } catch {}
      }
    };
  }, []);

  // Controls activity timer
  const triggerActivity = () => {
    setShowControls(true);
    if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current);
    }
    const hasOpenMenu =
      showQualityMenu ||
      showTranslatorMenu ||
      showSubtitleMenu ||
      showSpeedMenu ||
      showEpisodesDrawer;

    if (isPlaying && mode === "full" && !hasOpenMenu) {
      hideControlsTimer.current = setTimeout(() => {
        setShowControls(false);
        setShowQualityMenu(false);
        setShowTranslatorMenu(false);
        setShowSubtitleMenu(false);
        setShowSpeedMenu(false);
      }, 3500);
    }
  };

  // Keyboard navigation & Shortcuts (ArrowLeft/Right = ±5s, ArrowUp/Down = volume)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement)?.isContentEditable;

      if (isInputFocused) {
        return;
      }

      const isModalOpen = Boolean(document.querySelector('[data-modal-open="true"]'));
      if (mode === "docked" && isModalOpen) {
        return;
      }

      if (isMiniMode) {
        handleMiniMouseMove();
      } else {
        triggerActivity();
      }

      const code = e.code;
      const key = (e.key || "").toLowerCase();

      // Play / Pause (Space, K)
      if (code === "Space" || code === "KeyK" || key === " " || key === "k" || key === "л") {
        e.preventDefault();
        togglePlay();
        return;
      }

      // Seek backward (ArrowLeft)
      if (code === "ArrowLeft" || key === "arrowleft") {
        e.preventDefault();
        seekDelta(e.shiftKey ? -30 : -5);
        return;
      }

      // Seek forward (ArrowRight)
      if (code === "ArrowRight" || key === "arrowright") {
        e.preventDefault();
        seekDelta(e.shiftKey ? 30 : 5);
        return;
      }

      // Screenshot (S)
      if (code === "KeyS" || key === "s" || key === "і" || key === "ы") {
        e.preventDefault();
        handleScreenshot();
        return;
      }

      // A-B Loop (L)
      if (code === "KeyL" || key === "l" || key === "д") {
        e.preventDefault();
        handleCycleAbLoop();
        return;
      }

      // Stream info statistics (I)
      if (code === "KeyI" || key === "i" || key === "ш") {
        e.preventDefault();
        setShowMediaInfo((prev) => !prev);
        return;
      }

      // Volume Up (ArrowUp)
      if (code === "ArrowUp" || key === "arrowup") {
        e.preventDefault();
        adjustVolume(0.05);
        return;
      }

      // Volume Down (ArrowDown)
      if (code === "ArrowDown" || key === "arrowdown") {
        e.preventDefault();
        adjustVolume(-0.05);
        return;
      }

      // Mute (M)
      if (code === "KeyM" || key === "m" || key === "ь") {
        e.preventDefault();
        toggleMute();
        return;
      }

      // Fullscreen (F / F11)
      if (code === "KeyF" || key === "f" || key === "а" || key === "f11") {
        e.preventDefault();
        if (mode === "full") {
          toggleFullscreen();
        } else {
          if (mode === "os_pip") {
            handleSetOsPip(false);
          }
          onModeChange("full");
        }
        return;
      }

      // Escape
      if (code === "Escape" || key === "escape") {
        e.preventDefault();
        if (contextMenu?.open) {
          if (contextMenu.page !== "main") {
            setContextMenu({ ...contextMenu, page: "main" });
          } else {
            setContextMenu(null);
          }
        } else if (showMediaInfo) {
          setShowMediaInfo(false);
        } else if (showEpisodesDrawer) {
          setShowEpisodesDrawer(false);
        } else if (showQualityMenu || showTranslatorMenu || showSubtitleMenu || showSpeedMenu) {
          setShowQualityMenu(false);
          setShowTranslatorMenu(false);
          setShowSubtitleMenu(false);
          setShowSpeedMenu(false);
        } else if (mode === "full" && (isFullscreen || (typeof document !== "undefined" && Boolean(document.fullscreenElement)))) {
          toggleFullscreen(false);
        } else if (mode === "os_pip") {
          handleSetOsPip(false);
        } else if (mode === "docked") {
          const isPlayerFocused = containerRef.current?.contains(document.activeElement);
          if (isPlayerFocused) {
            handleTeardownAndClose();
          }
        } else {
          handleTeardownAndClose();
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isPlaying,
    mode,
    volume,
    isMuted,
    isFullscreen,
    toggleFullscreen,
    showEpisodesDrawer,
    showQualityMenu,
    showTranslatorMenu,
    showSubtitleMenu,
    showSpeedMenu,
    contextMenu,
    showMediaInfo,
    loopA,
    loopB,
    details.title,
    handleTeardownAndClose,
    onModeChange,
  ]);

  // Single click vs Double click on video
  const hasOpenMenu =
    showQualityMenu ||
    showTranslatorMenu ||
    showSubtitleMenu ||
    showSpeedMenu ||
    showEpisodesDrawer ||
    Boolean(contextMenu);

  const closeAllMenus = () => {
    setShowQualityMenu(false);
    setShowTranslatorMenu(false);
    setShowSubtitleMenu(false);
    setShowSpeedMenu(false);
    setShowEpisodesDrawer(false);
    setContextMenu(null);
  };

  const handleVideoClick = (e: React.MouseEvent) => {
    if (hasOpenMenu) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      closeAllMenus();
      return;
    }
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      handleVideoDoubleClick(e);
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      togglePlay();
      clickTimerRef.current = null;
    }, 230);
  };

  const handleVideoDoubleClick = (e: React.MouseEvent) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    const now = performance.now();
    if (now - lastDblClickTimeRef.current < 280) {
      return;
    }
    lastDblClickTimeRef.current = now;
    if (mode === "os_pip" || mode === "docked") {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      if (clickX < rect.width / 2) {
        seekDelta(-5);
        triggerMiniSeekRipple("left");
      } else {
        seekDelta(5);
        triggerMiniSeekRipple("right");
      }
      return;
    }
    if (mode === "full") {
      toggleFullscreen();
    } else {
      if (mode === "os_pip") {
        handleSetOsPip(false);
      }
      onModeChange("full");
    }
  };

  // Playback control helpers
  const togglePlay = () => {
    closeAllMenus();
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      syncMprisState(true, true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      syncMprisState(true, false);
    }
  };

  const seekDelta = (seconds: number) => {
    if (!videoRef.current) return;
    const cur = Number.isFinite(videoRef.current.currentTime)
      ? videoRef.current.currentTime
      : 0;
    commitSeekToVideo(cur + seconds);
    showHud(seconds > 0 ? `⏩ +${seconds} сек` : `⏪ ${seconds} сек`);
  };

  const adjustVolume = (delta: number) => {
    if (!videoRef.current) return;
    const newVol = Math.max(0, Math.min(1, volume + delta));
    videoRef.current.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
    showHud(`🔊 ${Math.round(newVol * 100)}%`);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
    showHud(newMuted ? "🔇 Без звуку" : `🔊 ${Math.round(volume * 100)}%`);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const target = e.target as HTMLElement | null;
    const isOverMenuOrDrawer = Boolean(
      target?.closest("[data-scrollable]") ||
      target?.closest(".overflow-y-auto") ||
      target?.closest(".overflow-x-auto") ||
      showEpisodesDrawer ||
      contextMenu?.open ||
      showQualityMenu ||
      showTranslatorMenu ||
      showSubtitleMenu ||
      showSpeedMenu
    );

    if (mode === "os_pip" || mode === "docked" || (mode === "full" && !isOverMenuOrDrawer)) {
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const newVol = Math.max(0, Math.min(1, Math.round((volume + delta) * 100) / 100));
      setVolume(newVol);
      if (videoRef.current) {
        videoRef.current.volume = newVol;
        videoRef.current.muted = newVol === 0;
      }
      setIsMuted(newVol === 0);
      showHud(newVol === 0 ? "🔇 Без звуку" : `🔊 ${Math.round(newVol * 100)}%`);
    }
  };

  // Switch Quality preserving position & persist user's quality preference
  const handleSelectQuality = (quality: StreamQuality) => {
    setSelectedQuality(quality);
    setPreferredQualityLabel(quality.label);
    try {
      localStorage.setItem("rdx_preferred_quality", quality.label);
    } catch {}
    api
      .getSettings()
      .then((s) => api.updateSettings({ ...s, preferred_quality: quality.label }))
      .catch(() => {});
    setShowQualityMenu(false);
    showHud(`Якість: ${quality.label}`);
  };

  // Switch Playback Speed
  const handleSelectSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
    showHud(`Швидкість: ${speed}x`);
  };

  // Switch Subtitles
  const handleSelectSubtitle = (trackUrl: string) => {
    setSelectedSubtitle(trackUrl);
    setShowSubtitleMenu(false);

    if (!videoRef.current) return;
    const existingTracks = videoRef.current.querySelectorAll("track");
    existingTracks.forEach((t) => t.remove());

    if (trackUrl !== "off") {
      const sub = streamData?.subtitles.find((s) => s.url === trackUrl);
      const subLabel =
        (sub as any)?.title ||
        (sub as any)?.lang ||
        sub?.label ||
        "Субтитри";
      const lower = subLabel.toLowerCase();
      let srclang = "uk";
      if (lower.includes("англ") || lower.includes("eng")) srclang = "en";
      else if (lower.includes("укр") || lower.includes("ukr")) srclang = "uk";
      else if (lower.includes("рос") || lower.includes("rus")) srclang = "ru";
      else if ((sub as any)?.lang) srclang = (sub as any).lang;

      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subLabel;
      track.srclang = srclang;
      track.src = trackUrl;
      track.default = true;
      videoRef.current.appendChild(track);
      if (videoRef.current.textTracks[0]) {
        videoRef.current.textTracks[0].mode = "showing";
      }
      showHud(`Субтитри: ${subLabel}`);
    } else {
      showHud("Субтитри вимкнено");
    }
  };

  // Always-on-Top OS PiP Toggle (Tauri command)
  const handleSetOsPip = async (enable: boolean) => {
    try {
      await api.setMiniPlayerMode(enable);
      onModeChange(enable ? "os_pip" : "full");
    } catch (e) {
      console.warn("Tauri setMiniPlayerMode failed, fallback to Web PiP:", e);
      if (videoRef.current && document.pictureInPictureEnabled) {
        if (!document.pictureInPictureElement) {
          videoRef.current.requestPictureInPicture().catch(() => {});
        } else {
          document.exitPictureInPicture().catch(() => {});
        }
      }
    }
  };

  // Previous Episode handler
  const handlePrevEpisode = () => {
    if (!isSeries || !activeSeason || !activeEpisode || !onEpisodeChange) return;

    const currentSeasonEps = episodes.filter(
      (ep) => ep.season_id === String(activeSeason)
    );
    const currentIdx = currentSeasonEps.findIndex(
      (ep) => parseInt(ep.episode_id, 10) === activeEpisode
    );

    if (currentIdx > 0) {
      const prevEpNum = parseInt(currentSeasonEps[currentIdx - 1].episode_id, 10);
      onEpisodeChange(activeSeason, prevEpNum);
    } else {
      const prevSeason = activeSeason - 1;
      const prevSeasonEps = episodes.filter(
        (ep) => ep.season_id === String(prevSeason)
      );
      if (prevSeasonEps.length > 0) {
        const lastEpNum = parseInt(
          prevSeasonEps[prevSeasonEps.length - 1].episode_id,
          10
        );
        onEpisodeChange(prevSeason, lastEpNum);
      }
    }
  };

  // Next Episode handler
  const handleNextEpisode = useCallback((): boolean => {
    if (!isSeries || !activeSeason || !activeEpisode || !onEpisodeChange) return false;

    const currentSeasonEps = episodes.filter(
      (ep) => ep.season_id === String(activeSeason)
    );
    const nextEpIndex = currentSeasonEps.findIndex(
      (ep) => parseInt(ep.episode_id, 10) === activeEpisode + 1
    );

    if (nextEpIndex !== -1) {
      onEpisodeChange(activeSeason, activeEpisode + 1);
      return true;
    } else {
      const nextSeason = activeSeason + 1;
      const nextSeasonEps = episodes.filter(
        (ep) => ep.season_id === String(nextSeason)
      );
      if (nextSeasonEps.length > 0) {
        onEpisodeChange(nextSeason, 1);
        return true;
      }
    }
    return false;
  }, [isSeries, activeSeason, activeEpisode, onEpisodeChange, episodes]);

  // Video playback completion handler
  const handleVideoEnded = () => {
    if (isSeries && autoplayNext && !nextEpDismissed) {
      const target = getNextEpisodeTarget();
      const hasNext = handleNextEpisode();
      if (hasNext) {
        if (target?.isNewSeason) {
          showHud(`⏭ Новий сезон: Сезон ${target.season}, Серія ${target.episode}`);
        } else {
          showHud("⏭ Наступна серія");
        }
        return;
      }
    }
    setIsPlaying(false);
    syncMprisState(true, false);
  };

  // References to latest handlers so listeners are mounted ONCE and never leak or drop events
  const syncMprisRef = useRef(syncMprisState);
  syncMprisRef.current = syncMprisState;
  const commitSeekRef = useRef(commitSeekToVideo);
  commitSeekRef.current = commitSeekToVideo;
  const seekDeltaRef = useRef(seekDelta);
  seekDeltaRef.current = seekDelta;
  const handleNextEpisodeRef = useRef(handleNextEpisode);
  handleNextEpisodeRef.current = handleNextEpisode;
  const handlePrevEpisodeRef = useRef(handlePrevEpisode);
  handlePrevEpisodeRef.current = handlePrevEpisode;
  const isSeriesRef = useRef(isSeries);
  isSeriesRef.current = isSeries;

  // MPRIS Remote Actions from OS (keyboard media keys, system shade, lockscreen)
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let unlistenAction: (() => void) | undefined;
    let unlistenSeek: (() => void) | undefined;
    let unlistenPosition: (() => void) | undefined;

    listen<string>("mpris-action", (event) => {
      const video = videoRef.current;
      if (!video) return;

      switch (event.payload) {
        case "play":
          video.play().catch(() => {});
          setIsPlaying(true);
          syncMprisRef.current(true, true);
          break;
        case "pause":
          video.pause();
          setIsPlaying(false);
          syncMprisRef.current(true, false);
          break;
        case "toggle":
          if (video.paused) {
            video.play().catch(() => {});
            setIsPlaying(true);
            syncMprisRef.current(true, true);
          } else {
            video.pause();
            setIsPlaying(false);
            syncMprisRef.current(true, false);
          }
          break;
        case "next":
          if (isSeriesRef.current) handleNextEpisodeRef.current();
          break;
        case "prev":
          if (isSeriesRef.current) handlePrevEpisodeRef.current();
          break;
      }
    }).then((un) => {
      unlistenAction = un;
    });

    listen<number>("mpris-seek", (event) => {
      seekDeltaRef.current(event.payload);
    }).then((un) => {
      unlistenSeek = un;
    });

    listen<number>("mpris-set-position", (event) => {
      const targetTime = event.payload;
      if (Number.isFinite(targetTime) && targetTime >= 0) {
        commitSeekRef.current(targetTime);
        syncMprisRef.current(true, undefined, targetTime);
      }
    }).then((un) => {
      unlistenPosition = un;
    });

    return () => {
      unlistenAction?.();
      unlistenSeek?.();
      unlistenPosition?.();
    };
  }, []);

  // Episodes for drawer's selected season
  const drawerSeasonEpisodes =
    episodes.filter((ep) => ep.season_id === String(drawerSeason)) || [];

  // Fallback drawerSeason if selected season has 0 episodes in the active translator
  useEffect(() => {
    if (isSeries && seasons.length > 0 && drawerSeasonEpisodes.length === 0) {
      const firstSeason = parseInt(seasons[0].id, 10);
      if (!isNaN(firstSeason) && firstSeason !== drawerSeason) {
        setDrawerSeason(firstSeason);
      }
    }
  }, [isSeries, seasons, drawerSeason, drawerSeasonEpisodes.length]);

  // ==================== RENDERING (UNIFIED SINGLE VIDEO TREE) ====================
  return (
    <motion.div
      ref={containerRef}
      data-player-mode={mode}
      drag={mode === "docked"}
      dragMomentum={false}
      dragElastic={0.08}
      animate={mode !== "docked" ? { x: 0, y: 0 } : undefined}
      onMouseMove={(e) => {
        if (mode === "full") {
          triggerActivity();
        } else {
          handleMiniMouseMove();
          if (mode === "os_pip" && pipDragStartRef.current?.isDown) {
            const dx = Math.abs(e.clientX - pipDragStartRef.current.x);
            const dy = Math.abs(e.clientY - pipDragStartRef.current.y);
            if (dx > 4 || dy > 4) {
              pipDragStartRef.current = null;
              if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
                clickTimerRef.current = null;
              }
              api.startDragWindow().catch(() => {});
            }
          }
        }
      }}
      onMouseLeave={() => {
        if (isMiniMode) {
          handleMiniMouseLeave();
        }
      }}
      onMouseUp={() => {
        if (pipDragStartRef.current) {
          pipDragStartRef.current = null;
        }
      }}
      onClick={mode === "full" ? triggerActivity : undefined}
      onContextMenu={handleContextMenu}
      onWheel={handleWheel}
      onMouseDown={(e) => {
        if (
          mode === "os_pip" &&
          e.button === 0 &&
          !(e.target as HTMLElement).closest("button") &&
          !(e.target as HTMLElement).closest("input")
        ) {
          pipDragStartRef.current = { x: e.clientX, y: e.clientY, isDown: true };
        }
      }}
      className={cn(
        "z-50 select-none overflow-hidden bg-black",
        mode === "full" && "fixed inset-0 flex items-center justify-center",
        mode === "os_pip" && "fixed inset-0 flex flex-col group cursor-grab active:cursor-grabbing",
        mode === "docked" &&
          "fixed bottom-6 right-6 w-96 aspect-video rounded-2xl shadow-2xl border border-white/20 group cursor-grab active:cursor-grabbing"
      )}
    >
      {/* Dynamic Subtitle Styling */}
      <style>{`
        video::cue {
          font-size: ${
            subFontSize === "sm"
              ? "16px"
              : subFontSize === "lg"
              ? "28px"
              : subFontSize === "xl"
              ? "34px"
              : "22px"
          } !important;
          background-color: rgba(0, 0, 0, ${subBgOpacity / 100}) !important;
        }
      `}</style>

      {/* Persistent Video Stage */}
      <div
        key="video-stage"
        className="relative w-full h-full overflow-hidden bg-black flex items-center justify-center"
      >
        <video
          ref={videoRef}
          title=""
          controls={false}
          disablePictureInPicture={false}
          controlsList="nodownload nofullscreen noremoteplayback"
          onContextMenu={handleContextMenu}
          className={cn(
            "w-full h-full cursor-pointer relative z-0",
            getVideoObjectFitClass()
          )}
          style={getVideoStyle()}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => {
            setIsBuffering(false);
            if (!isSeekingRef.current) setIsPlaying(true);
          }}
          onCanPlay={() => {
            syncDurationFromVideo();
            setIsBuffering(false);
          }}
          onTimeUpdate={() => {
            if (!videoRef.current) return;
            const time = videoRef.current.currentTime;
            if (!isDraggingSeek && Number.isFinite(time)) {
              const minUiDelta = showControls || showMediaInfo ? 0.25 : 0.9;
              setCurrentTime((prev) =>
                Math.abs(time - prev) >= minUiDelta ? time : prev
              );
            }
            if (effectiveDur <= 0) {
              syncDurationFromVideo();
            }
            if (loopA !== null && loopB !== null && loopB > loopA) {
              if (time >= loopB) {
                videoRef.current.currentTime = loopA;
              }
            }
            syncMprisState(false);
          }}
          onLoadedMetadata={syncDurationFromVideo}
          onDurationChange={syncDurationFromVideo}
          onSeeking={() => {
            isSeekingRef.current = true;
            setIsSeeking(true);
          }}
          onSeeked={() => {
            if (seekClearTimeoutRef.current) clearTimeout(seekClearTimeoutRef.current);
            isSeekingRef.current = false;
            setIsSeeking(false);
            if (videoRef.current && !videoRef.current.paused) {
              setIsPlaying(true);
            }
            syncMprisState(true);
          }}
          onPlay={() => {
            if (!isSeekingRef.current) {
              setIsPlaying(true);
              syncMprisState(true, true);
            }
          }}
          onPause={() => {
            if (isSeekingRef.current || videoRef.current?.seeking) {
              return;
            }
            setIsPlaying(false);
            syncMprisState(true, false);
          }}
          onEnded={handleVideoEnded}
          onClick={handleVideoClick}
          onDoubleClick={handleVideoDoubleClick}
        />

        {/* Real-time WebGL Deband + AMD CAS Canvas (Layered at z-10) */}
        <canvas
          ref={shaderCanvasRef}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 m-auto w-full h-full pointer-events-none z-10 transition-opacity duration-150",
            getVideoObjectFitClass(),
            videoEnhanceMode !== "off" && shaderReady ? "opacity-100" : "opacity-0"
          )}
          style={getVideoStyle()}
        />

        {/* ================= DOUBLE-TAP SEEK RIPPLE INDICATORS ================= */}
        {isMiniMode && miniSeekRipple === "left" && (
          <div className="absolute inset-y-0 left-0 w-1/3 flex items-center justify-center pointer-events-none z-30 animate-pulse">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md flex flex-col items-center justify-center text-white text-xs font-bold shadow-2xl">
              <Rewind className="w-5 h-5 fill-current" />
              <span>-5с</span>
            </div>
          </div>
        )}
        {isMiniMode && miniSeekRipple === "right" && (
          <div className="absolute inset-y-0 right-0 w-1/3 flex items-center justify-center pointer-events-none z-30 animate-pulse">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md flex flex-col items-center justify-center text-white text-xs font-bold shadow-2xl">
              <FastForward className="w-5 h-5 fill-current" />
              <span>+5с</span>
            </div>
          </div>
        )}

        {/* ================= UNIFIED MINI-PLAYER OVERLAY (OS PiP & Docked) ================= */}
        {isMiniMode && (
          <div
            className={cn(
              "absolute inset-0 z-20 flex flex-col justify-between transition-opacity duration-200 pointer-events-none",
              miniControlsVisible ? "opacity-100" : "opacity-0"
            )}
          >
            {/* Top Shadow Gradient */}
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-none" />

            {/* Top Row: Volume & Title Capsule on Left, Window Controls on Right */}
            <div className="relative z-10 flex items-center justify-between p-3">
              {/* Left Capsule: Speaker + Volume Slider + Series/Movie Tag */}
              <div
                className="pointer-events-auto flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-full px-2.5 py-1.5 border border-white/15 shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={toggleMute}
                  className="text-white hover:text-rose-400 transition-colors cursor-pointer"
                  title={isMuted ? "Увімкнути звук (M)" : "Вимкнути звук (M)"}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 text-white" />
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (videoRef.current) {
                      videoRef.current.volume = v;
                      videoRef.current.muted = v === 0;
                    }
                    setVolume(v);
                    setIsMuted(v === 0);
                  }}
                  className="w-14 sm:w-16 h-1 accent-rose-500 cursor-pointer"
                  title={`Гучність: ${Math.round(volume * 100)}%`}
                />

                {/* S1E2 or Movie Title with strict max-width limit */}
                {isSeries ? (
                  <span className="text-[10px] text-zinc-300 font-mono font-bold border-l border-white/20 pl-2 shrink-0">
                    S{activeSeason}E{activeEpisode}
                  </span>
                ) : (
                  <span
                    className="text-[10px] text-zinc-300 font-medium border-l border-white/20 pl-2 max-w-[110px] sm:max-w-[140px] truncate shrink-0"
                    title={details.title}
                  >
                    {details.title}
                  </span>
                )}
              </div>

              {/* Right: Maximize / Return to Full App + Close X */}
              <div
                className="pointer-events-auto flex items-center gap-1.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {mode === "docked" && (
                  <button
                    onClick={() => handleSetOsPip(true)}
                    title="Поверх усіх вікон (Always-on-Top)"
                    className="w-8 h-8 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
                  >
                    <PictureInPicture2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => {
                    if (mode === "os_pip") handleSetOsPip(false);
                    onModeChange("full");
                  }}
                  title="Розгорнути на весь екран"
                  className="w-8 h-8 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (mode === "os_pip") handleSetOsPip(false);
                    handleTeardownAndClose();
                  }}
                  title="Закрити плеєр"
                  className="w-8 h-8 rounded-full bg-black/60 hover:bg-rose-600 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Center Controls: Rewind -5s, Big Play/Pause, Forward +5s, Next Episode */}
            <div className="relative z-10 flex items-center justify-center gap-4 sm:gap-5 pointer-events-none">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  seekDelta(-5);
                  triggerMiniSeekRipple("left");
                }}
                title="Назад на 5 сек"
                className="pointer-events-auto w-10 h-10 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-90 cursor-pointer shadow-lg"
              >
                <Rewind className="w-4 h-4 fill-current/30" />
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                title={isPlaying ? "Пауза" : "Відтворити"}
                className="pointer-events-auto w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-2xl shadow-rose-950/80 transition-all hover:scale-110 active:scale-90 cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-0.5" />
                )}
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  seekDelta(5);
                  triggerMiniSeekRipple("right");
                }}
                title="Вперед на 5 сек"
                className="pointer-events-auto w-10 h-10 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-90 cursor-pointer shadow-lg"
              >
                <FastForward className="w-4 h-4 fill-current/30" />
              </button>

              {isSeries && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNextEpisode();
                  }}
                  title="Наступна серія"
                  className="pointer-events-auto w-9 h-9 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-90 cursor-pointer shadow-lg"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Bottom Row: Scrubber & Timecodes */}
            <div
              className="relative z-10 px-4 pb-3 pt-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-auto"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-300 font-semibold mb-1 pointer-events-none">
                <span>{formatTime(currentTime)}</span>
                <span>-{formatTime(Math.max(0, effectiveDur - currentTime))}</span>
              </div>

              {/* Edge-to-edge sleek scrubber */}
              <div
                className="relative w-full h-1 group/track hover:h-2 rounded-full bg-white/20 cursor-pointer transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0) return;
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const effDur = getEffectiveDuration();
                  if (effDur > 0) {
                    const target = pct * effDur;
                    setCurrentTime(target);
                    commitSeekToVideo(target);
                  }
                }}
              >
                <div
                  className="absolute top-0 bottom-0 left-0 bg-white/25 rounded-full pointer-events-none"
                  style={{ width: `${bufferedPct}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 left-0 bg-rose-600 rounded-full shadow-md shadow-rose-600/50 pointer-events-none"
                  style={{ width: `${playedPct}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ================= FULL SCREEN CINEMA OSD OVERLAY ================= */}
        {mode === "full" && (
          <>
            {/* Auto-Resume Toast */}
            {resumeNotice && (
              <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-40 bg-zinc-900/90 border border-white/20 text-white px-5 py-2.5 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2 animate-bounce">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>{resumeNotice}</span>
              </div>
            )}

            {/* HUD Toast (Seek / Volume / Speed) */}
            {hudToast && (
              <div className="absolute top-28 left-1/2 transform -translate-x-1/2 z-40 bg-black/80 border border-white/20 text-white px-5 py-2 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-2">
                <span>{hudToast}</span>
              </div>
            )}

            {/* In-Player Season & Episode Drawer Overlay */}
            {showEpisodesDrawer && isSeries && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-24 left-1/2 transform -translate-x-1/2 w-[92%] max-w-2xl bg-zinc-900/95 border border-white/20 rounded-3xl p-5 shadow-2xl z-50 space-y-4 max-h-[70vh] flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2 text-white font-bold text-sm">
                    <ListVideo className="w-4 h-4 text-rose-500" />
                    <span>Вибір серії ({details.title})</span>
                  </div>
                  <button
                    onClick={() => setShowEpisodesDrawer(false)}
                    className="p-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Season Selector inside Player */}
                {seasons.length >= 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar flex-shrink-0">
                    {seasons.map((s) => {
                      const sNum = parseInt(s.id, 10);
                      const isCurrent = drawerSeason === sNum;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setDrawerSeason(sNum)}
                          className={cn(
                            "px-4 py-1.5 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap cursor-pointer",
                            isCurrent
                              ? "bg-white text-zinc-950 shadow-md font-extrabold"
                              : "bg-zinc-800 text-zinc-400 hover:text-white border border-white/10"
                          )}
                        >
                          {s.title}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Episode Grid inside Player */}
                <div className="overflow-y-auto max-h-72 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 pr-1">
                  {drawerSeasonEpisodes.map((ep) => {
                    const epNum = parseInt(ep.episode_id, 10);
                    const isPlayingEp =
                      activeSeason === drawerSeason && activeEpisode === epNum;
                    const epProg = episodeProgressMap[`${drawerSeason}-${epNum}`];
                    const pct =
                      epProg && epProg.duration_sec > 0
                        ? Math.min(100, Math.round((epProg.position_sec / epProg.duration_sec) * 100))
                        : 0;
                    const isWatched = pct >= 90;

                    return (
                      <button
                        key={`${ep.season_id}-${ep.episode_id}`}
                        onClick={() => {
                          if (onEpisodeChange) {
                            onEpisodeChange(drawerSeason, epNum);
                          }
                          setShowEpisodesDrawer(false);
                        }}
                        className={cn(
                          "relative overflow-hidden flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer group",
                          isPlayingEp
                            ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/60"
                            : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-white/10"
                        )}
                      >
                        {isWatched && (
                          <div className="absolute top-1 right-1 flex items-center" title="Переглянуто">
                            <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                          </div>
                        )}
                        <span className="font-bold text-sm">{ep.episode_id}</span>
                        <span
                          className={cn(
                            "text-[10px] transition-colors",
                            isPlayingEp
                              ? "text-white/95 font-medium"
                              : "text-zinc-400 group-hover:text-zinc-200"
                          )}
                        >
                          {isWatched ? "переглянуто" : "серія"}
                        </span>
                        {pct > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                            <div
                              className={cn("h-full", isWatched ? "bg-emerald-400" : "bg-rose-500")}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Next Episode Countdown Overlay Card */}
            {mode === "full" &&
              isSeries &&
              autoplayNext &&
              !nextEpDismissed &&
              nextEpTarget !== null &&
              effectiveDur > 20 &&
              remainingSec <= 15 &&
              remainingSec > 0 &&
              !loadingStream && (
                <div
                  data-testid="next-episode-card"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-28 right-6 sm:right-10 z-40 w-80 rounded-2xl bg-zinc-950/95 border border-white/15 p-4 shadow-2xl backdrop-blur-xl pointer-events-auto animate-in fade-in slide-in-from-bottom-3 duration-200"
                >
                  <div className="flex items-center justify-between mb-2">
                    {nextEpTarget.isNewSeason ? (
                      <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-black uppercase px-2 py-0.5 rounded-md">
                        🌟 НОВИЙ СЕЗОН
                      </span>
                    ) : (
                      <span className="text-rose-400 text-[11px] font-bold uppercase tracking-wider">
                        Наступна серія
                      </span>
                    )}
                    <span className="text-xs text-zinc-400 font-mono">
                      {Math.ceil(remainingSec)} с
                    </span>
                  </div>

                  <div className="text-sm font-bold text-white mb-2">
                    {nextEpTarget.isNewSeason
                      ? `Перехід на Сезон ${nextEpTarget.season}, Серія ${nextEpTarget.episode}`
                      : `Сезон ${nextEpTarget.season}, Серія ${nextEpTarget.episode}`}
                  </div>

                  <div className="text-xs text-zinc-400 mb-3">
                    Автоперехід через {Math.ceil(remainingSec)} с...
                  </div>

                  {/* Thin progress bar filling 0% to 100% over 15 seconds */}
                  <div className="w-full h-1 bg-white/10 rounded-full mb-3.5 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, ((15 - remainingSec) / 15) * 100))}%`,
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        handleNextEpisode();
                        showHud(
                          nextEpTarget.isNewSeason
                            ? `⏭ Новий сезон: С${nextEpTarget.season} Е${nextEpTarget.episode}`
                            : `⏭ Сезон ${nextEpTarget.season}, Серія ${nextEpTarget.episode}`
                        );
                      }}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-950/50 transition-all flex-1 justify-center"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Дивитися зараз</span>
                    </button>
                    <button
                      onClick={() => setNextEpDismissed(true)}
                      className="bg-white/10 hover:bg-white/15 text-zinc-300 text-xs font-semibold px-3 py-2 rounded-xl cursor-pointer transition-all"
                    >
                      Скасувати
                    </button>
                  </div>
                </div>
              )}

            {/* OSD CONTROLS OVERLAY */}
            <div
              className={cn(
                "absolute inset-0 flex flex-col justify-between p-6 sm:p-10 transition-opacity duration-300 pointer-events-none z-30",
                showControls ? "opacity-100" : "opacity-0"
              )}
            >
              {/* Top OSD Header */}
              <div className="flex items-center justify-between pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent -mx-6 -mt-6 p-6 sm:-mx-10 sm:-mt-10 sm:p-10">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                      {details.title}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      {isSeries && (
                        <span className="font-semibold text-rose-400">
                          Сезон {activeSeason}, Серія {activeEpisode}
                        </span>
                      )}
                      <span>•</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span>{currentTranslator?.name}</span>
                        {currentTranslator?.is_premium && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black uppercase tracking-wider">
                            <Crown className="w-2.5 h-2.5 text-amber-400" />
                            PREMIUM
                          </span>
                        )}
                      </span>
                      {selectedQuality && (
                        <>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 font-mono text-[11px]">
                            {isPremiumQuality(selectedQuality.label) && (
                              <Crown className="w-3 h-3 text-amber-400 fill-amber-400/25 flex-shrink-0" />
                            )}
                            <span>{selectedQuality.label}</span>
                          </span>
                        </>
                      )}
                    </div>

                    {(currentTranslator?.is_premium || streamData?.is_premium) && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/80 border border-amber-500/40 text-amber-200 text-xs shadow-xl backdrop-blur-md mt-1">
                        <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Ця озвучка доступна лише з HDRezka Premium (сайт транслює промо-ролик із QR-кодом)</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Settings Menu Gear Button */}
                  <button
                    ref={settingsBtnRef}
                    onClick={handleToggleSettingsMenu}
                    title="Налаштування плеєра"
                    className={cn(
                      "h-10 w-10 rounded-xl border border-white/15 transition-all cursor-pointer flex items-center justify-center flex-shrink-0",
                      contextMenu?.open
                        ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/50"
                        : "bg-zinc-900/90 hover:bg-zinc-800 text-white"
                    )}
                  >
                    <Settings className="w-4 h-4" />
                  </button>

                  {/* Always-on-Top OS PiP Window (Matching square icon button) */}
                  <button
                    onClick={() => handleSetOsPip(true)}
                    title="Перейти в режим поверх усіх вікон (Always-on-Top)"
                    className="h-10 w-10 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 transition-all cursor-pointer flex items-center justify-center flex-shrink-0"
                  >
                    <PictureInPicture2 className="w-4 h-4" />
                  </button>

                  {/* Close */}
                  <button
                    onClick={handleTeardownAndClose}
                    title="Закрити плеєр"
                    className="h-10 w-10 rounded-xl bg-zinc-900/90 hover:bg-rose-600 text-white border border-white/15 transition-all cursor-pointer flex items-center justify-center flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Center Quick Pause/Play Indicator or Loading Spinner */}
              <div className="self-center pointer-events-none">
                {loadingStream || isBuffering ? (
                  <div className="w-16 h-16 rounded-full bg-black/75 border border-white/20 flex flex-col items-center justify-center text-rose-500 shadow-2xl backdrop-blur-md gap-1">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                ) : !isPlaying && !isSeeking ? (
                  <div className="w-20 h-20 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white shadow-2xl">
                    <Play className="w-10 h-10 fill-current ml-1" />
                  </div>
                ) : null}
              </div>

              {/* Bottom OSD Controls */}
              <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/60 to-transparent -mx-6 -mb-6 p-6 sm:-mx-10 sm:-mb-10 sm:p-10 space-y-4">
                {/* Custom Smooth SeekBar with Buffered bar, Played bar, A-B Loop Markers, and Hover Time Tooltip */}
                <div
                  className="space-y-1.5"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    ref={seekBarRef}
                    onPointerDown={handleSeekPointerDown}
                    onPointerMove={handleSeekPointerMove}
                    onPointerUp={handleSeekPointerUp}
                    onPointerCancel={handleSeekPointerUp}
                    onPointerLeave={handleSeekPointerLeave}
                    className="relative w-full h-5 flex items-center cursor-pointer group select-none touch-none"
                  >
                    {/* Hover Time & Sprite Thumbnail Tooltip */}
                    {hoverTime !== null && effectiveDur > 0 && (() => {
                      const activeCue = thumbnailCues.find(
                        (c) => hoverTime >= c.start && hoverTime <= c.end
                      );
                      return (
                        <div
                          className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none select-none z-30"
                          style={{
                            left: `${hoverX}px`,
                            bottom: activeCue ? "100%" : "28px",
                            marginBottom: activeCue ? "8px" : "0px",
                          }}
                        >
                          {activeCue && (
                            <div
                              className="border border-white/20 rounded-lg overflow-hidden shadow-2xl bg-black mb-1.5"
                              style={{
                                width: `${activeCue.w || 160}px`,
                                height: `${activeCue.h || 90}px`,
                                backgroundImage: `url("${activeCue.url}")`,
                                backgroundPosition: `-${activeCue.x || 0}px -${activeCue.y || 0}px`,
                                backgroundRepeat: "no-repeat",
                              }}
                            />
                          )}
                          <div className="px-2 py-0.5 rounded-md bg-zinc-900/95 border border-white/20 text-white text-[11px] font-mono shadow-xl whitespace-nowrap">
                            {formatTime(hoverTime)}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Rail / Track Background */}
                    <div className="relative w-full h-1.5 group-hover:h-2 rounded-full bg-white/20 transition-all overflow-hidden">
                      {/* Buffered Progress Bar */}
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-white/25 rounded-full pointer-events-none"
                        style={{ width: `${bufferedPct}%` }}
                      />

                      {/* A-B Loop Shaded Region */}
                      {effectiveDur > 0 && loopA !== null && (
                        <div
                          className="absolute top-0 bottom-0 bg-rose-500/30 border-x border-rose-400 pointer-events-none"
                          style={{
                            left: `${(loopA / effectiveDur) * 100}%`,
                            width: `${((loopB !== null ? loopB - loopA : effectiveDur - loopA) / effectiveDur) * 100}%`,
                          }}
                        />
                      )}

                      {/* Played Progress Bar */}
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-rose-600 rounded-full shadow-lg shadow-rose-600/50 pointer-events-none"
                        style={{ width: `${playedPct}%` }}
                      />
                    </div>

                    {/* A Marker Tick */}
                    {effectiveDur > 0 && loopA !== null && (
                      <div
                        className="absolute -top-1 w-2.5 h-3.5 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
                        style={{ left: `${(loopA / effectiveDur) * 100}%` }}
                      >
                        <div className="w-1.5 h-3 bg-amber-400 rounded-sm shadow-md" />
                        <span className="text-[9px] font-bold text-amber-300 font-mono -mt-0.5">A</span>
                      </div>
                    )}

                    {/* B Marker Tick */}
                    {effectiveDur > 0 && loopB !== null && (
                      <div
                        className="absolute -top-1 w-2.5 h-3.5 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
                        style={{ left: `${(loopB / effectiveDur) * 100}%` }}
                      >
                        <div className="w-1.5 h-3 bg-amber-400 rounded-sm shadow-md" />
                        <span className="text-[9px] font-bold text-amber-300 font-mono -mt-0.5">B</span>
                      </div>
                    )}

                    {/* Seek Thumb */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg shadow-black/50 border border-rose-500 scale-0 group-hover:scale-100 transition-transform pointer-events-none z-20"
                      style={{ left: `${playedPct}%` }}
                    />
                  </div>

                  {/* Clickable Time Display */}
                  <div className="flex justify-between text-xs font-mono text-zinc-300 px-0.5 select-none">
                    <button
                      onClick={() => setShowRemainingTime(!showRemainingTime)}
                      className="hover:text-white transition-colors cursor-pointer text-left"
                      title="Натисніть щоб змінити формат (минулий / залишок)"
                    >
                      {showRemainingTime ? `-${formatTime(Math.max(0, effectiveDur - currentTime))}` : formatTime(currentTime)}
                    </button>
                    <button
                      onClick={() => setShowRemainingTime(!showRemainingTime)}
                      className="hover:text-white transition-colors cursor-pointer text-right"
                      title="Натисніть щоб змінити формат (минулий / залишок)"
                    >
                      {formatTime(effectiveDur)}
                    </button>
                  </div>
                </div>

                {/* Controls Bottom Row: Clean single row that never wraps into 2 lines */}
                <div className="flex items-center justify-between gap-1.5 sm:gap-3 flex-nowrap min-w-0">
                  {/* Left Controls: Play/Pause, Prev/Next Ep, Seek ±5s, Volume */}
                  <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                    <button
                      onClick={togglePlay}
                      className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-rose-950/60 transition-all cursor-pointer flex-shrink-0"
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5 sm:w-6 sm:h-6" />
                      ) : (
                        <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current ml-0.5" />
                      )}
                    </button>

                    {/* Prev Episode Button (Series only) */}
                    {isSeries && (
                      <button
                        onClick={handlePrevEpisode}
                        title="Попередня серія"
                        className="h-10 w-10 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 transition-colors cursor-pointer flex items-center justify-center flex-shrink-0"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>
                    )}

                    {/* -5s Seek */}
                    <button
                      onClick={() => seekDelta(-5)}
                      title="Назад на 5 сек (←)"
                      className="h-10 px-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 transition-colors cursor-pointer flex items-center justify-center gap-1 flex-shrink-0"
                    >
                      <Rewind className="w-4 h-4 fill-current/30" />
                      <span className="text-[11px] font-bold">5s</span>
                    </button>

                    {/* +5s Seek */}
                    <button
                      onClick={() => seekDelta(5)}
                      title="Вперед на 5 сек (→)"
                      className="h-10 px-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 transition-colors cursor-pointer flex items-center justify-center gap-1 flex-shrink-0"
                    >
                      <FastForward className="w-4 h-4 fill-current/30" />
                      <span className="text-[11px] font-bold">5s</span>
                    </button>

                    {/* Next Episode Button (Series only) */}
                    {isSeries && (
                      <button
                        onClick={handleNextEpisode}
                        title="Наступна серія"
                        className="h-10 w-10 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 transition-colors cursor-pointer flex items-center justify-center flex-shrink-0"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    )}

                    {/* Volume Slider integrated in cohesive h-10 dark glass capsule */}
                    <div className="h-10 px-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/80 border border-white/15 flex items-center gap-2 cursor-pointer flex-shrink-0 transition-colors">
                      <button
                        onClick={toggleMute}
                        title="Без звуку (M)"
                        className="text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                      >
                        {isMuted || volume === 0 ? (
                          <VolumeX className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (videoRef.current) {
                            videoRef.current.volume = v;
                            videoRef.current.muted = false;
                          }
                          setVolume(v);
                          setIsMuted(false);
                        }}
                        className="w-14 sm:w-18 h-1 rounded appearance-none bg-white/20 accent-rose-500 cursor-pointer hidden xs:block"
                      />
                    </div>
                  </div>

                  {/* Right Controls: In-Player Season/Episode Selector, Audio, Speed, Quality, Subtitles */}
                  <div className="flex items-center gap-1 sm:gap-1.5 relative flex-shrink-0">
                    {/* Screenshot Frame Button (S) - desktop only */}
                    <button
                      onClick={handleScreenshot}
                      title="Зробити знімок кадру (S)"
                      className="hidden lg:flex h-10 w-10 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 cursor-pointer items-center justify-center flex-shrink-0"
                    >
                      <Camera className="w-4 h-4" />
                    </button>

                    {/* Stream Info Overlay Button (I) - desktop only */}
                    <button
                      onClick={() => setShowMediaInfo(!showMediaInfo)}
                      title="Статистика потоку (I)"
                      className={cn(
                        "hidden lg:flex h-10 w-10 rounded-xl border border-white/15 transition-colors cursor-pointer items-center justify-center flex-shrink-0",
                        showMediaInfo
                          ? "bg-rose-600 border-rose-500 text-white"
                          : "bg-zinc-900/90 hover:bg-zinc-800 text-white"
                      )}
                    >
                      <Info className="w-4 h-4" />
                    </button>

                    {/* Compact In-Player Season & Episode Selector */}
                    {isSeries && (
                      <button
                        onClick={() => {
                          setShowEpisodesDrawer(!showEpisodesDrawer);
                          setShowQualityMenu(false);
                          setShowTranslatorMenu(false);
                          setShowSubtitleMenu(false);
                          setShowSpeedMenu(false);
                        }}
                        className="h-10 flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 rounded-xl bg-rose-600/30 hover:bg-rose-600/50 text-white text-xs font-semibold border border-rose-500/40 cursor-pointer shadow-md transition-all flex-shrink-0"
                        title="Вибір сезону та серії"
                      >
                        <ListVideo className="w-4 h-4 text-rose-400 flex-shrink-0" />
                        <span className="hidden sm:inline text-zinc-300 font-normal">Серії:</span>
                        <strong className="text-zinc-100 font-bold whitespace-nowrap">S{activeSeason}E{activeEpisode}</strong>
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      </button>
                    )}

                    {/* Compact Audio Track (Озвучка) Selector */}
                    {details.translators.length > 1 && (
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowTranslatorMenu(!showTranslatorMenu);
                            setShowQualityMenu(false);
                            setShowSubtitleMenu(false);
                            setShowSpeedMenu(false);
                            setShowEpisodesDrawer(false);
                          }}
                          className="h-10 flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white text-xs font-semibold border border-white/15 cursor-pointer shadow-md transition-all flex-shrink-0"
                          title="Вибір озвучення"
                        >
                          <Tv className="w-4 h-4 text-rose-400 flex-shrink-0" />
                          <span className="hidden md:inline text-zinc-300 font-normal">Озвучка:</span>
                          <strong className="text-zinc-100 max-w-[80px] sm:max-w-[120px] truncate inline-block align-bottom font-medium">
                            {currentTranslator?.name}
                          </strong>
                          {currentTranslator?.is_premium && (
                            <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                        </button>

                        {showTranslatorMenu && (
                          <div className="absolute bottom-12 right-0 w-64 max-h-72 overflow-y-auto bg-zinc-900 border border-white/15 rounded-2xl shadow-2xl p-2 space-y-1 z-50">
                            <div className="text-[11px] font-bold text-zinc-400 px-2 py-1 uppercase">
                              Вибір озвучення
                            </div>
                            {details.translators.map((t) => {
                              const isSelected = t.id === currentTranslator?.id;
                              const isUkr =
                                t.language?.toLowerCase().includes("украин") ||
                                t.language?.toLowerCase().includes("україн");

                              return (
                                <button
                                  key={t.id}
                                  onClick={() => {
                                    if (onTranslatorChange) onTranslatorChange(t.id);
                                    setShowTranslatorMenu(false);
                                  }}
                                  className={cn(
                                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer",
                                    isSelected
                                      ? "bg-rose-600 text-white"
                                      : "text-zinc-300 hover:bg-white/10"
                                  )}
                                >
                                  <span className="truncate flex items-center gap-1.5">
                                    {isUkr && <UaFlag />}
                                    <span>{t.name}</span>
                                    {t.is_premium && (
                                      <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5 shrink-0">
                                        <Crown className="w-2.5 h-2.5 text-amber-400" />
                                        PREM
                                      </span>
                                    )}
                                  </span>
                                  {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Playback Speed Trigger */}
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowSpeedMenu(!showSpeedMenu);
                          setShowQualityMenu(false);
                          setShowTranslatorMenu(false);
                          setShowSubtitleMenu(false);
                          setShowEpisodesDrawer(false);
                        }}
                        className="h-10 flex items-center gap-1 px-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white text-xs font-semibold border border-white/15 cursor-pointer flex-shrink-0"
                        title="Швидкість відтворення"
                      >
                        <Gauge className="w-4 h-4" />
                        <span>{playbackSpeed}x</span>
                      </button>

                      {showSpeedMenu && (
                        <div className="absolute bottom-12 right-0 w-32 bg-zinc-900 border border-white/15 rounded-2xl shadow-2xl p-2 space-y-1 z-50">
                          <div className="text-[11px] font-bold text-zinc-400 px-2 py-1 uppercase">
                            Швидкість
                          </div>
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                            <button
                              key={s}
                              onClick={() => handleSelectSpeed(s)}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                                playbackSpeed === s
                                  ? "bg-rose-600 text-white"
                                  : "text-zinc-300 hover:bg-white/10"
                              )}
                            >
                              <span>{s}x</span>
                              {playbackSpeed === s && <Check className="w-3.5 h-3.5" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Quality Menu Trigger */}
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowQualityMenu(!showQualityMenu);
                          setShowTranslatorMenu(false);
                          setShowSubtitleMenu(false);
                          setShowSpeedMenu(false);
                          setShowEpisodesDrawer(false);
                        }}
                        className="h-10 flex items-center gap-1.5 px-3 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white text-xs font-semibold border border-white/15 cursor-pointer flex-shrink-0"
                      >
                        {isPremiumQuality(selectedQuality?.label) ? (
                          <Crown className="w-4 h-4 text-amber-400 fill-amber-400/25" />
                        ) : (
                          <Settings className="w-4 h-4" />
                        )}
                        <span>{selectedQuality?.label || "Якість"}</span>
                      </button>

                      {showQualityMenu && streamData && (
                        <div className="absolute bottom-12 right-0 w-48 bg-zinc-900 border border-white/15 rounded-2xl shadow-2xl p-2 space-y-1 z-50">
                          <div className="text-[11px] font-bold text-zinc-400 px-2 py-1 uppercase">
                            Якість відео
                          </div>
                          {streamData.qualities.map((q) => {
                            const isPrem = isPremiumQuality(q.label);
                            return (
                              <button
                                key={q.label}
                                onClick={() => handleSelectQuality(q)}
                                className={cn(
                                  "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                                  selectedQuality?.label === q.label
                                    ? "bg-rose-600 text-white"
                                    : "text-zinc-300 hover:bg-white/10"
                                )}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span>{q.label}</span>
                                  {isPrem && (
                                    <span title="HDRezka Premium якість" className="inline-flex">
                                      <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400/25 flex-shrink-0" />
                                    </span>
                                  )}
                                </span>
                                {selectedQuality?.label === q.label && (
                                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Subtitles Trigger */}
                    {streamData && streamData.subtitles.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowSubtitleMenu(!showSubtitleMenu);
                            setShowQualityMenu(false);
                            setShowTranslatorMenu(false);
                            setShowSpeedMenu(false);
                            setShowEpisodesDrawer(false);
                          }}
                          className="h-10 w-10 flex items-center justify-center rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 cursor-pointer flex-shrink-0"
                          title="Субтитри"
                        >
                          <Subtitles className="w-4 h-4" />
                        </button>

                        {showSubtitleMenu && (
                          <div className="absolute bottom-12 right-0 w-60 max-h-96 overflow-y-auto bg-zinc-900 border border-white/15 rounded-2xl shadow-2xl p-2.5 space-y-2 z-50">
                            <div className="text-[11px] font-bold text-zinc-400 px-1 uppercase">
                              Субтитри
                            </div>
                            <div className="space-y-1 max-h-40 overflow-y-auto pr-0.5">
                              <button
                                onClick={() => handleSelectSubtitle("off")}
                                className={cn(
                                  "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                                  selectedSubtitle === "off"
                                    ? "bg-rose-600 text-white"
                                    : "text-zinc-300 hover:bg-white/10"
                                )}
                              >
                                <span>Вимкнено</span>
                                {selectedSubtitle === "off" && <Check className="w-3.5 h-3.5" />}
                              </button>
                              {streamData.subtitles.map((sub, i) => (
                                <button
                                  key={i}
                                  onClick={() => handleSelectSubtitle(sub.url)}
                                  className={cn(
                                    "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                                    selectedSubtitle === sub.url
                                      ? "bg-rose-600 text-white"
                                      : "text-zinc-300 hover:bg-white/10"
                                  )}
                                >
                                  <span className="truncate">{sub.label}</span>
                                  {selectedSubtitle === sub.url && (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              ))}
                            </div>

                            {/* Subtitle Customizer controls */}
                            <div className="border-t border-white/10 pt-2 space-y-2">
                              {/* Font size */}
                              <div>
                                <div className="text-[10px] font-bold text-zinc-400 px-1 mb-1">
                                  Розмір
                                </div>
                                <div className="grid grid-cols-4 gap-1">
                                  {(["sm", "md", "lg", "xl"] as const).map((size) => (
                                    <button
                                      key={size}
                                      onClick={() => {
                                        setSubFontSize(size);
                                        showHud(`Розмір субтитрів: ${size.toUpperCase()}`);
                                      }}
                                      className={cn(
                                        "py-1 rounded text-[11px] font-bold uppercase transition-all cursor-pointer text-center",
                                        subFontSize === size
                                          ? "bg-rose-600 text-white"
                                          : "bg-white/5 hover:bg-white/15 text-zinc-300"
                                      )}
                                    >
                                      {size === "sm" ? "S" : size === "md" ? "M" : size === "lg" ? "L" : "XL"}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Background opacity */}
                              <div>
                                <div className="text-[10px] font-bold text-zinc-400 px-1 mb-1">
                                  Фон
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  {[0, 60, 90].map((op) => (
                                    <button
                                      key={op}
                                      onClick={() => {
                                        setSubBgOpacity(op);
                                        showHud(`Фон субтитрів: ${op}%`);
                                      }}
                                      className={cn(
                                        "py-1 rounded text-[11px] font-bold transition-all cursor-pointer text-center",
                                        subBgOpacity === op
                                          ? "bg-rose-600 text-white"
                                          : "bg-white/5 hover:bg-white/15 text-zinc-300"
                                      )}
                                    >
                                      {op}%
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Timing offset */}
                              <div>
                                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 px-1 mb-1">
                                  <span>Затримка</span>
                                  <span className="font-mono text-zinc-200">
                                    {subOffsetSec >= 0 ? `+${subOffsetSec.toFixed(1)}` : subOffsetSec.toFixed(1)}с
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  <button
                                    onClick={() => adjustSubtitleOffset(-0.5)}
                                    className="py-1 rounded text-[11px] font-bold bg-white/5 hover:bg-white/15 text-zinc-300 cursor-pointer text-center"
                                  >
                                    -0.5с
                                  </button>
                                  <button
                                    onClick={() => adjustSubtitleOffset(-subOffsetSec)}
                                    className="py-1 rounded text-[11px] font-bold bg-white/5 hover:bg-white/15 text-zinc-300 cursor-pointer text-center"
                                  >
                                    0с
                                  </button>
                                  <button
                                    onClick={() => adjustSubtitleOffset(0.5)}
                                    className="py-1 rounded text-[11px] font-bold bg-white/5 hover:bg-white/15 text-zinc-300 cursor-pointer text-center"
                                  >
                                    +0.5с
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* True Fullscreen Toggle Button */}
                    <button
                      onClick={() => toggleFullscreen()}
                      title={isFullscreen ? "Вийти з повного екрана (F)" : "На весь екран (F)"}
                      data-testid="fullscreen-btn"
                      className="h-10 w-10 flex items-center justify-center rounded-xl bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 cursor-pointer flex-shrink-0"
                    >
                      {isFullscreen ? (
                        <Minimize className="w-4 h-4" />
                      ) : (
                        <Maximize className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        {/* ================= VAYOU-STYLE MEDIA INFO OVERLAY ================= */}
        {showMediaInfo && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-16 left-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] bg-zinc-950/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4.5 text-xs font-mono text-zinc-300 shadow-2xl shadow-black/80 space-y-2.5 select-none animate-in fade-in duration-150"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <Info className="w-4 h-4 text-rose-500" />
                <span>Статистика потоку</span>
              </div>
              <button
                onClick={() => setShowMediaInfo(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Назва:</span>
                <span className="text-right truncate ml-2 max-w-[220px] text-white font-sans">{details.title}</span>
              </div>
              {isSeries && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500 shrink-0">Серія:</span>
                  <span className="text-white font-bold font-mono">S{activeSeason}E{activeEpisode}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Роздільність:</span>
                <span className="text-emerald-400 font-bold font-mono">
                  {videoRef.current ? `${videoRef.current.videoWidth}×${videoRef.current.videoHeight}` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Частота кадрів:</span>
                <span
                  className={cn(
                    "font-bold font-mono",
                    (videoEnhanceMode !== "off" ? renderFps : streamFps) >= 23
                      ? "text-emerald-400"
                      : "text-amber-400"
                  )}
                >
                  {videoRef.current && videoRef.current.videoWidth > 0 ? (
                    isPlaying ? (
                      `${(videoEnhanceMode !== "off" ? renderFps : streamFps) || 24} FPS`
                    ) : (
                      "Пауза"
                    )
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Покращення:</span>
                <span
                  className={cn(
                    "font-medium text-right truncate max-w-[220px]",
                    videoEnhanceMode === "off"
                      ? "text-zinc-400"
                      : videoEnhanceMode === "max"
                      ? "text-rose-400"
                      : "text-amber-400"
                  )}
                >
                  {videoEnhanceMode === "off"
                    ? "Вимкнено (0% GPU)"
                    : videoEnhanceMode === "deband"
                    ? "Deband (згладжування)"
                    : videoEnhanceMode === "cas"
                    ? "AMD CAS (чіткість)"
                    : "Макс (Deband + CAS)"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Якість:</span>
                <span className="text-white font-mono">{selectedQuality?.label || "Auto"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Тип потоку:</span>
                <span className="text-rose-400 truncate ml-2 font-medium">
                  {selectedQuality?.mp4_url ? "Прямий MP4 (Voidboost)" : "HLS Manifest"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Smart CDN:</span>
                <span className="text-emerald-400 font-mono font-medium truncate ml-2 max-w-[220px]" title={streamData?.cdn_host || "Voidboost Edge"}>
                  {streamData?.cdn_host || "Voidboost Edge"} {streamData?.cdn_ping_ms ? `(${streamData.cdn_ping_ms} мс)` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Turbo-буфер:</span>
                <span className={cn("font-medium shrink-0", turboBufferEnabled ? "text-amber-400 font-bold" : "text-zinc-400")}>
                  {turboBufferEnabled ? "⚡ Активний (Multi-segment)" : "Вимкнено"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 shrink-0">Буфер:</span>
                <span className="text-white font-mono">
                  {videoRef.current ? `${Math.max(0, getBufferedEnd() - currentTime).toFixed(1)} сек` : "—"}
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
                  {currentTranslator?.name || "Оригінал"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================= VAYOU-STYLE RIGHT-CLICK CONTEXT MENU ================= */}
      {contextMenu?.open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[100] min-w-[270px] max-w-[350px] py-1.5 bg-zinc-950/95 border border-white/15 rounded-2xl shadow-2xl text-xs text-white/90 select-none overflow-hidden"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          {contextMenu.page === "main" && (
            <div className="space-y-0.5">
              {/* Translators / Audio tracks */}
              {details.translators.length > 0 && (
                <button
                  onClick={() => setContextMenu({ ...contextMenu, page: "translators" })}
                  className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Tv className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="truncate">Озвучка</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                    <span className="max-w-[110px] truncate">{currentTranslator?.name}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                  </div>
                </button>
              )}

              {/* Series Episodes Jump */}
              {isSeries && (
                <button
                  onClick={() => setContextMenu({ ...contextMenu, page: "episodes" })}
                  className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <ListVideo className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="truncate">Сезон та Серія</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium font-mono">
                    <span>S{activeSeason}E{activeEpisode}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                  </div>
                </button>
              )}

              {/* Quality Submenu */}
              {streamData && streamData.qualities.length > 0 && (
                <button
                  onClick={() => setContextMenu({ ...contextMenu, page: "quality" })}
                  className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Settings className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="truncate">Якість відео</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium font-mono">
                    {isPremiumQuality(selectedQuality?.label) && (
                      <Crown className="w-3 h-3 text-amber-400 fill-amber-400/25 flex-shrink-0" />
                    )}
                    <span>{selectedQuality?.label || "Auto"}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                  </div>
                </button>
              )}

              {/* Speed Submenu */}
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "speed" })}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Gauge className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span className="truncate">Швидкість</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium font-mono">
                  <span>{playbackSpeed}x</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                </div>
              </button>

              {/* Subtitles Submenu */}
              {streamData && streamData.subtitles.length > 0 && (
                <button
                  onClick={() => setContextMenu({ ...contextMenu, page: "subtitles" })}
                  className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Subtitles className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="truncate">Субтитри</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                    <span className="max-w-[110px] truncate">
                      {selectedSubtitle === "off"
                        ? "Вимкнено"
                        : streamData?.subtitles.find((s) => s.url === selectedSubtitle)?.label ||
                          (streamData?.subtitles.find((s) => s.url === selectedSubtitle) as any)?.title ||
                          "Увімкнено"}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                  </div>
                </button>
              )}

              {/* Aspect Ratio Submenu */}
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "aspect" })}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Maximize className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span className="truncate">Пропорції</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium uppercase font-mono">
                  <span>{aspectRatioMode}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                </div>
              </button>

              {/* Video Enhancement Submenu */}
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "enhance" })}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Sparkles
                    className={cn(
                      "w-4 h-4 flex-shrink-0 transition-colors",
                      videoEnhanceMode !== "off" ? "text-rose-400" : "text-zinc-400 group-hover:text-zinc-300"
                    )}
                  />
                  <span className="truncate">Покращення відео</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-zinc-400 font-medium">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors",
                      videoEnhanceMode !== "off"
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        : "bg-white/5 text-zinc-400"
                    )}
                  >
                    {videoEnhanceMode === "off"
                      ? "Вимк"
                      : videoEnhanceMode === "deband"
                      ? "Deband"
                      : videoEnhanceMode === "cas"
                      ? "CAS"
                      : "Макс"}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                </div>
              </button>

              {/* Autoplay Next Series toggle */}
              {isSeries && (
                <button
                  onClick={() => {
                    const nextVal = !autoplayNext;
                    setAutoplayNext(nextVal);
                    try {
                      localStorage.setItem("rdx_autoplay_next", String(nextVal));
                    } catch {}
                    api
                      .getSettings()
                      .then((s) => api.updateSettings({ ...s, autoplay_next: nextVal } as any))
                      .catch(() => {});
                    showHud(nextVal ? "Автоперехід: Увімкнено" : "Автоперехід: Вимкнено");
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Repeat className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span>Автоперехід серій</span>
                  </div>
                  <span className={cn("text-xs font-bold font-mono", autoplayNext ? "text-emerald-400" : "text-zinc-500")}>
                    {autoplayNext ? "Увімк" : "Вимк"}
                  </span>
                </button>
              )}

              <div className="h-px bg-white/10 my-1 mx-2" />

              {/* A-B Loop Button (L) */}
              <button
                onClick={() => {
                  handleCycleAbLoop();
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Repeat className={cn("w-4 h-4 flex-shrink-0", loopA !== null ? "text-amber-400" : "text-zinc-400")} />
                  <span>Повтор відрізка A–B</span>
                  {loopA !== null && (
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                      {loopB !== null ? "A•B" : "A"}
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-zinc-500 pl-2">L</span>
              </button>

              {/* Screenshot Frame (S) */}
              <button
                onClick={() => {
                  handleScreenshot();
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Camera className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span>Зробити знімок кадру</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-500 pl-2">S</span>
              </button>

              {/* Media Info (I) */}
              <button
                onClick={() => {
                  setShowMediaInfo(!showMediaInfo);
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Info className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span>Статистика потоку</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-500 pl-2">I</span>
              </button>

              {/* Turbo Buffer Toggle */}
              <button
                onClick={() => {
                  const next = !turboBufferEnabled;
                  setTurboBufferEnabled(next);
                  try {
                    localStorage.setItem("rdx_turbo_buffer", String(next));
                  } catch {}
                  showHud(next ? "⚡ Turbo-буфер: Увімкнено (Prefetch)" : "Turbo-буфер: Вимкнено");
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Zap className={cn("w-4 h-4 flex-shrink-0", turboBufferEnabled ? "text-amber-400 fill-amber-400/25" : "text-zinc-400")} />
                  <span>Turbo-буфер (Segment Prefetch)</span>
                </div>
                {turboBufferEnabled && <Check className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
              </button>

              {/* Sleep Timer */}
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "sleep" })}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Timer className={cn("w-4 h-4 flex-shrink-0", sleepTimerSecondsLeft !== null ? "text-rose-400" : "text-zinc-400")} />
                  <span>Таймер сну</span>
                  {sleepTimerSecondsLeft !== null && (
                    <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[10px] font-mono">
                      {formatSleepTime(sleepTimerSecondsLeft)}
                    </span>
                  )}
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              </button>

              <div className="h-px bg-white/10 my-1 mx-2" />

              {/* Mode switch */}
              {mode !== "docked" && (
                <button
                  onClick={() => {
                    onModeChange("docked");
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span>Міні-плеєр у кутку</span>
                </button>
              )}
              {mode !== "os_pip" && (
                <button
                  onClick={() => {
                    handleSetOsPip(true);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <PictureInPicture2 className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span>Поверх усіх вікон (PiP)</span>
                </button>
              )}
              {mode !== "full" && (
                <button
                  onClick={() => {
                    if (mode === "os_pip") handleSetOsPip(false);
                    onModeChange("full");
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span>Розгорнути на весь екран</span>
                </button>
              )}
            </div>
          )}

          {/* Submenu: Translators */}
          {contextMenu.page === "translators" && (
            <div className="space-y-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Озвучення</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
                {details.translators.map((t) => {
                  const isSelected = t.id === currentTranslator?.id;
                  const isUkr =
                    t.language?.toLowerCase().includes("украин") ||
                    t.language?.toLowerCase().includes("україн");
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        if (onTranslatorChange) onTranslatorChange(t.id);
                        setContextMenu(null);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer",
                        isSelected ? "bg-rose-600 text-white" : "text-zinc-300 hover:bg-white/10"
                      )}
                    >
                      <span className="truncate flex items-center gap-1.5">
                        {isUkr && <UaFlag />}
                        <span>{t.name}</span>
                        {t.is_premium && (
                          <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5 shrink-0">
                            <Crown className="w-2.5 h-2.5 text-amber-400" />
                            PREM
                          </span>
                        )}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Submenu: Episodes */}
          {contextMenu.page === "episodes" && (
            <div className="space-y-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Серії (Сезон {drawerSeason})</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              {seasons.length >= 1 && (
                <div className="flex gap-1 px-2 py-1 overflow-x-auto no-scrollbar">
                  {seasons.map((s) => {
                    const sNum = parseInt(s.id, 10);
                    return (
                      <button
                        key={s.id}
                        onClick={() => setDrawerSeason(sNum)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all whitespace-nowrap cursor-pointer",
                          drawerSeason === sNum
                            ? "bg-white text-zinc-950"
                            : "bg-zinc-800 text-zinc-400 hover:text-white"
                        )}
                      >
                        {s.title}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="max-h-60 overflow-y-auto grid grid-cols-4 gap-1 p-2">
                {drawerSeasonEpisodes.map((ep) => {
                  const epNum = parseInt(ep.episode_id, 10);
                  const isCurrent = activeSeason === drawerSeason && activeEpisode === epNum;
                  const epProg = episodeProgressMap[`${drawerSeason}-${epNum}`];
                  const pct =
                    epProg && epProg.duration_sec > 0
                      ? Math.min(100, Math.round((epProg.position_sec / epProg.duration_sec) * 100))
                      : 0;
                  const isWatched = pct >= 90;

                  return (
                    <button
                      key={`${ep.season_id}-${ep.episode_id}`}
                      onClick={() => {
                        if (onEpisodeChange) onEpisodeChange(drawerSeason, epNum);
                        setContextMenu(null);
                      }}
                      className={cn(
                        "relative overflow-hidden p-1.5 rounded-lg text-center font-bold text-xs transition-colors cursor-pointer",
                        isCurrent
                          ? "bg-rose-600 text-white"
                          : "bg-white/5 hover:bg-white/15 text-zinc-300"
                      )}
                    >
                      {isWatched && (
                        <div className="absolute top-0.5 right-0.5" title="Переглянуто">
                          <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                        </div>
                      )}
                      <span>{ep.episode_id}</span>
                      {pct > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20">
                          <div
                            className={cn("h-full", isWatched ? "bg-emerald-400" : "bg-rose-500")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Submenu: Quality */}
          {contextMenu.page === "quality" && streamData && (
            <div className="space-y-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Якість відео</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              {streamData.qualities.map((q) => {
                const isSelected = selectedQuality?.label === q.label;
                const isPrem = isPremiumQuality(q.label);
                return (
                  <button
                    key={q.label}
                    onClick={() => {
                      handleSelectQuality(q);
                      setContextMenu(null);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                      isSelected ? "bg-rose-600 text-white" : "text-zinc-300 hover:bg-white/10"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{q.label}</span>
                      {isPrem && (
                        <span title="HDRezka Premium якість" className="inline-flex">
                          <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400/25 flex-shrink-0" />
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Submenu: Speed */}
          {contextMenu.page === "speed" && (
            <div className="space-y-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Швидкість відтворення</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    handleSelectSpeed(s);
                    setContextMenu(null);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                    playbackSpeed === s ? "bg-rose-600 text-white" : "text-zinc-300 hover:bg-white/10"
                  )}
                >
                  <span>{s}x {s === 1 ? "(Звичайна)" : ""}</span>
                  {playbackSpeed === s && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
          )}

          {/* Submenu: Aspect Ratio */}
          {contextMenu.page === "aspect" && (
            <div className="space-y-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Співвідношення сторін</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              {[
                { id: "auto", label: "Авто (Contain)" },
                { id: "cover", label: "Заповнити (Cover)" },
                { id: "fill", label: "Розтягнути (Fill)" },
                { id: "16:9", label: "16:9" },
                { id: "21:9", label: "21:9 (Cinema)" },
                { id: "4:3", label: "4:3 (Classic)" },
              ].map(({ id, label }) => {
                const isSelected = aspectRatioMode === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      setAspectRatioMode(id as any);
                      showHud(`Пропорції: ${label}`);
                      setContextMenu(null);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                      isSelected ? "bg-rose-600 text-white" : "text-zinc-300 hover:bg-white/10"
                    )}
                  >
                    <span>{label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Submenu: Sleep Timer */}
          {contextMenu.page === "sleep" && (
            <div className="space-y-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Таймер сну</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              {sleepTimerSecondsLeft !== null && (
                <div className="px-3 py-2 text-center bg-white/5 rounded-xl mx-1 mb-1">
                  <div className="text-rose-400 text-base font-bold font-mono">
                    {formatSleepTime(sleepTimerSecondsLeft)}
                  </div>
                  <button
                    onClick={() => {
                      setSleepTimer(null);
                      setContextMenu(null);
                    }}
                    className="mt-1 text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
                  >
                    Вимкнути таймер
                  </button>
                </div>
              )}
              {[15, 30, 45, 60, 90].map((mins) => (
                <button
                  key={mins}
                  onClick={() => {
                    setSleepTimer(mins);
                    setContextMenu(null);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                    sleepTimerMinutes === mins ? "bg-rose-600 text-white" : "text-zinc-300 hover:bg-white/10"
                  )}
                >
                  <span>{mins} хвилин</span>
                  {sleepTimerMinutes === mins && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
          )}

          {/* Submenu: Subtitles */}
          {contextMenu.page === "subtitles" && streamData && (
            <div className="space-y-0.5">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Субтитри</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              <button
                onClick={() => {
                  handleSelectSubtitle("off");
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                  selectedSubtitle === "off" ? "bg-rose-600 text-white" : "text-zinc-300 hover:bg-white/10"
                )}
              >
                <span>Вимкнено</span>
                {selectedSubtitle === "off" && <Check className="w-3.5 h-3.5" />}
              </button>
              <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
                {streamData.subtitles.map((sub, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      handleSelectSubtitle(sub.url);
                      setContextMenu(null);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                      selectedSubtitle === sub.url ? "bg-rose-600 text-white" : "text-zinc-300 hover:bg-white/10"
                    )}
                  >
                    <span>{sub.label || (sub as any).title || (sub as any).lang || `Субтитри ${i + 1}`}</span>
                    {selectedSubtitle === sub.url && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>

              {/* Subtitle Customizer controls */}
              <div className="border-t border-white/10 pt-2 px-1 space-y-2">
                <div>
                  <div className="text-[10px] font-bold text-zinc-400 px-1 mb-1">
                    Розмір тексту
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(["sm", "md", "lg", "xl"] as const).map((size) => (
                      <button
                        key={size}
                        onClick={() => {
                          setSubFontSize(size);
                          showHud(`Розмір субтитрів: ${size.toUpperCase()}`);
                        }}
                        className={cn(
                          "py-1 rounded text-[11px] font-bold uppercase transition-all cursor-pointer text-center",
                          subFontSize === size
                            ? "bg-rose-600 text-white"
                            : "bg-white/5 hover:bg-white/15 text-zinc-300"
                        )}
                      >
                        {size === "sm" ? "S" : size === "md" ? "M" : size === "lg" ? "L" : "XL"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-zinc-400 px-1 mb-1">
                    Фон
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[0, 60, 90].map((op) => (
                      <button
                        key={op}
                        onClick={() => {
                          setSubBgOpacity(op);
                          showHud(`Фон субтитрів: ${op}%`);
                        }}
                        className={cn(
                          "py-1 rounded text-[11px] font-bold transition-all cursor-pointer text-center",
                          subBgOpacity === op
                            ? "bg-rose-600 text-white"
                            : "bg-white/5 hover:bg-white/15 text-zinc-300"
                        )}
                      >
                        {op}%
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 px-1 mb-1">
                    <span>Затримка</span>
                    <span className="font-mono text-zinc-200">
                      {subOffsetSec >= 0 ? `+${subOffsetSec.toFixed(1)}` : subOffsetSec.toFixed(1)}с
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={() => adjustSubtitleOffset(-0.5)}
                      className="py-1 rounded text-[11px] font-bold bg-white/5 hover:bg-white/15 text-zinc-300 cursor-pointer text-center"
                    >
                      -0.5с
                    </button>
                    <button
                      onClick={() => adjustSubtitleOffset(-subOffsetSec)}
                      className="py-1 rounded text-[11px] font-bold bg-white/5 hover:bg-white/15 text-zinc-300 cursor-pointer text-center"
                    >
                      0с
                    </button>
                    <button
                      onClick={() => adjustSubtitleOffset(0.5)}
                      className="py-1 rounded text-[11px] font-bold bg-white/5 hover:bg-white/15 text-zinc-300 cursor-pointer text-center"
                    >
                      +0.5с
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Submenu: Video Enhance */}
          {contextMenu.page === "enhance" && (
            <div className="space-y-1">
              <button
                onClick={() => setContextMenu({ ...contextMenu, page: "main" })}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer font-semibold text-[11px]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Покращення відео</span>
              </button>
              <div className="h-px bg-white/10 my-1 mx-2" />
              {[
                {
                  mode: "off",
                  label: "Вимкнено",
                  desc: "Нативний потік (0% навантаження)",
                },
                {
                  mode: "deband",
                  label: "Згладжування (Deband)",
                  desc: "Прибирає сходинки градієнтів та квадрати",
                },
                {
                  mode: "cas",
                  label: "Чіткість (AMD CAS)",
                  desc: "Адаптивна різкість деталей без шуму",
                },
                {
                  mode: "max",
                  label: "Максимальне (Deband + CAS)",
                  desc: "Гладкі темні сцени + кришталева чіткість",
                },
              ].map((item) => {
                const isSelected = videoEnhanceMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    onClick={() => {
                      handleSelectEnhanceMode(item.mode as VideoEnhanceMode);
                      setContextMenu(null);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-xl text-left cursor-pointer transition-colors",
                      isSelected
                        ? "bg-rose-600 text-white"
                        : "text-zinc-300 hover:bg-white/10"
                    )}
                  >
                    <div>
                      <div className="text-xs font-semibold">{item.label}</div>
                      <div
                        className={cn(
                          "text-[10px]",
                          isSelected ? "text-rose-100" : "text-zinc-400"
                        )}
                      >
                        {item.desc}
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 flex-shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};
