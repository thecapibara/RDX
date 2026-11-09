import React, { useState, useEffect, useMemo } from "react";
import {
  Download,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Search,
  HardDrive,
  CheckCircle2,
  FolderOpen,
  X,
  Crown,
  Clock,
  Layers,
  Grid,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../services/api";
import { cn } from "../lib/utils";
import type { DownloadItem, DownloadProgressEvent } from "../types";

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

interface SeriesGroup {
  mediaId: string;
  title: string;
  origTitle?: string | null;
  posterUrl: string;
  mediaType: string;
  genres: string;
  translatorName: string;
  season?: number | null;
  episodes: DownloadItem[];
  completedCount: number;
  totalCount: number;
  downloadingCount: number;
  queuedCount: number;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesSec: number;
  allCompleted: boolean;
}

interface DownloadsViewProps {
  onPlayDownload: (item: DownloadItem) => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  onPlayDownload,
}) => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [activeType, setActiveType] = useState<
    "all" | "movie" | "series" | "cartoon" | "anime"
  >("all");
  const [selectedGenre, setSelectedGenre] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [downloadsDir, setDownloadsDir] = useState<string>("");
  const [isGroupedView, setIsGroupedView] = useState<boolean>(true);
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});

  // Load downloads from SQLite
  const loadDownloads = async () => {
    try {
      const items = await api.getDownloads();
      setDownloads(items);
    } catch (err) {
      console.warn("Failed to load downloads:", err);
    }
  };

  useEffect(() => {
    loadDownloads();
    api.getDownloadsDir().then(setDownloadsDir).catch(() => {});

    // Polling fallback to guarantee continuous 1s UI updates
    const pollInterval = setInterval(() => {
      loadDownloads();
    }, 1000);

    // Listen to real-time progress events from Rust
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenReload: (() => void) | null = null;

    listen<DownloadProgressEvent>("download://progress", (event) => {
      const payload = event.payload;
      setDownloads((prev) => {
        const found = prev.some((item) => item.id === payload.id);
        if (!found) {
          loadDownloads();
          return prev;
        }
        return prev.map((item) => {
          if (item.id === payload.id) {
            return {
              ...item,
              downloaded_bytes: payload.downloaded_bytes,
              total_bytes: payload.total_bytes > 0 ? payload.total_bytes : item.total_bytes,
              speed_bytes_sec: payload.speed_bytes_sec,
              status: payload.status as any,
            };
          }
          return item;
        });
      });
    }).then((un) => {
      unlistenProgress = un;
    }).catch(() => {});

    listen<{ id: string; file_path: string }>("download://complete", (event) => {
      const { id, file_path } = event.payload;
      setDownloads((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "completed",
                file_path: file_path || item.file_path,
                completed_at: Date.now(),
              }
            : item
        )
      );
    }).then((un) => {
      unlistenComplete = un;
    }).catch(() => {});

    listen("download://reload", () => {
      loadDownloads();
    }).then((un) => {
      unlistenReload = un;
    }).catch(() => {});

    return () => {
      clearInterval(pollInterval);
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenReload?.();
    };
  }, []);

  // Format bytes to human readable string
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return "0 МБ";
    const mb = bytes / (1024 * 1024);
    if (mb < 1000) return `${mb.toFixed(1)} МБ`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} ГБ`;
  };

  // Format speed (bytes/sec)
  const formatSpeed = (bytesSec?: number) => {
    if (!bytesSec || bytesSec <= 0) return "0 КБ/с";
    const mb = bytesSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} МБ/с`;
    const kb = bytesSec / 1024;
    return `${kb.toFixed(0)} КБ/с`;
  };

  // Format estimated remaining time (ETA)
  const getEtaString = (downloaded: number, total: number, speed?: number) => {
    if (!speed || speed <= 0 || total <= downloaded) return null;
    const remainingSecs = Math.round((total - downloaded) / speed);
    if (remainingSecs < 60) return `~${remainingSecs}с`;
    const m = Math.floor(remainingSecs / 60);
    const s = remainingSecs % 60;
    if (m < 60) return `~${m}хв ${s > 0 ? `${s}с` : ""}`;
    const h = Math.floor(m / 60);
    return `~${h}год ${m % 60}хв`;
  };

  // Extract all distinct genres from downloads
  const allGenres = useMemo(() => {
    const set = new Set<string>();
    for (const d of downloads) {
      if (d.genres) {
        d.genres
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
          .forEach((g) => set.add(g));
      }
    }
    return Array.from(set).sort();
  }, [downloads]);

  // Filtered downloads
  const filteredDownloads = useMemo(() => {
    return downloads.filter((d) => {
      if (activeType !== "all") {
        if (activeType === "movie" && d.media_type !== "movie") return false;
        if (activeType === "series" && d.media_type !== "series") return false;
        if (activeType === "cartoon" && d.media_type !== "cartoon") return false;
        if (activeType === "anime" && d.media_type !== "anime") return false;
      }

      if (selectedGenre !== "all") {
        if (!d.genres || !d.genres.toLowerCase().includes(selectedGenre.toLowerCase())) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = d.title.toLowerCase().includes(q);
        const matchesOrig = d.orig_title?.toLowerCase().includes(q);
        const matchesTrans = d.translator_name.toLowerCase().includes(q);
        if (!matchesTitle && !matchesOrig && !matchesTrans) return false;
      }

      return true;
    });
  }, [downloads, activeType, selectedGenre, searchQuery]);

  // Storage Stats
  const totalCompletedBytes = useMemo(() => {
    return downloads
      .filter((d) => d.status === "completed")
      .reduce((sum, d) => sum + (d.total_bytes || d.downloaded_bytes || 0), 0);
  }, [downloads]);

  const completedDownloadsCount = useMemo(() => {
    return downloads.filter((d) => d.status === "completed").length;
  }, [downloads]);

  const activeDownloadsCount = useMemo(() => {
    return downloads.filter((d) => d.status === "downloading").length;
  }, [downloads]);

  const queuedDownloadsCount = useMemo(() => {
    return downloads.filter((d) => d.status === "queued").length;
  }, [downloads]);

  // Smart Grouping Data
  const displayItems = useMemo(() => {
    if (!isGroupedView) {
      return filteredDownloads.map((item) => ({ type: "single" as const, item }));
    }

    const items: Array<
      | { type: "single"; item: DownloadItem }
      | { type: "series"; key: string; group: SeriesGroup }
    > = [];

    const seriesMap = new Map<string, DownloadItem[]>();

    for (const item of filteredDownloads) {
      const isSeriesItem =
        (item.media_type || "").toLowerCase().includes("series") ||
        item.season != null;

      if (isSeriesItem) {
        const key = `${item.media_id || item.title}:${item.season || 1}`;
        if (!seriesMap.has(key)) {
          seriesMap.set(key, []);
        }
        seriesMap.get(key)!.push(item);
      } else {
        items.push({ type: "single", item });
      }
    }

    for (const [key, eps] of seriesMap.entries()) {
      if (eps.length === 1) {
        items.push({ type: "single", item: eps[0] });
        continue;
      }

      eps.sort((a, b) => (a.episode || 0) - (b.episode || 0));

      const first = eps[0];
      const completedCount = eps.filter((e) => e.status === "completed").length;
      const downloadingCount = eps.filter((e) => e.status === "downloading").length;
      const queuedCount = eps.filter((e) => e.status === "queued").length;
      const totalCount = eps.length;
      const totalBytes = eps.reduce((sum, e) => sum + (e.total_bytes || 0), 0);
      const downloadedBytes = eps.reduce((sum, e) => sum + (e.downloaded_bytes || 0), 0);
      const totalSpeed = eps.reduce((sum, e) => sum + (e.speed_bytes_sec || 0), 0);

      items.push({
        type: "series",
        key,
        group: {
          mediaId: first.media_id,
          title: first.title,
          origTitle: first.orig_title,
          posterUrl: first.poster_url,
          mediaType: first.media_type,
          genres: first.genres,
          translatorName: first.translator_name,
          season: first.season,
          episodes: eps,
          completedCount,
          totalCount,
          downloadingCount,
          queuedCount,
          totalBytes,
          downloadedBytes,
          speedBytesSec: totalSpeed,
          allCompleted: completedCount === totalCount,
        },
      });
    }

    return items;
  }, [filteredDownloads, isGroupedView]);

  // Actions
  const handlePause = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.pauseDownload(id);
      setDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: "paused", speed_bytes_sec: 0 } : d))
      );
    } catch (err) {
      console.warn("Pause error:", err);
    }
  };

  const handleResume = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.resumeDownload(id);
      setDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: "downloading" } : d))
      );
    } catch (err) {
      console.warn("Resume error:", err);
    }
  };

  const handleCancel = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.cancelDownload(id);
      setDownloads((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.warn("Cancel error:", err);
    }
  };

  const handleDelete = async (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Видалити «${title}» з пам'яті комп'ютера?`)) {
      try {
        await api.deleteDownload(id);
        setDownloads((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        console.warn("Delete error:", err);
      }
    }
  };

  const handlePauseAll = async () => {
    try {
      await api.pauseAllDownloads();
      loadDownloads();
    } catch (err) {
      console.warn("Pause all error:", err);
    }
  };

  const handleResumeAll = async () => {
    try {
      await api.resumeAllDownloads();
      loadDownloads();
    } catch (err) {
      console.warn("Resume all error:", err);
    }
  };

  const handleClearCompleted = async () => {
    if (confirm("Очистити список завершених завантажень? (файли залишаться на диску)")) {
      try {
        await api.clearCompletedDownloads();
        loadDownloads();
      } catch (err) {
        console.warn("Clear completed error:", err);
      }
    }
  };

  const handleShowInFolder = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.showInFolder(filePath);
    } catch (err) {
      console.warn("Show in folder error:", err);
    }
  };

  const toggleSeriesExpand = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="w-full min-h-screen px-4 md:px-8 py-6 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500">
              <Download className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
                Завантаження
              </h1>
              <p className="text-xs text-zinc-400 mt-0.5">
                Офлайн-бібліотека фільмів та серіалів без потреби в інтернеті
              </p>
            </div>
          </div>
        </div>

        {/* Global Controls & Stats */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Queue Global Actions */}
          <div className="flex items-center gap-1.5 p-1 bg-zinc-900/90 rounded-xl border border-white/10 text-xs">
            {activeDownloadsCount > 0 ? (
              <button
                onClick={handlePauseAll}
                title="Призупинити всі завантаження"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white transition-all cursor-pointer font-medium"
              >
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Призупинити всі</span>
              </button>
            ) : (
              <button
                onClick={handleResumeAll}
                title="Відновити всі завантаження"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white transition-all cursor-pointer font-semibold shadow-sm shadow-rose-950/40"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Відновити всі</span>
              </button>
            )}

            {completedDownloadsCount > 0 && (
              <button
                onClick={handleClearCompleted}
                title="Очистити список завершених (файли залишаться на диску)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Очистити готові</span>
              </button>
            )}
          </div>

          {/* Folder Open */}
          {downloadsDir && (
            <button
              onClick={() => api.showInFolder(downloadsDir)}
              title={`Відкрити системну папку: ${downloadsDir}`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900/90 border border-white/10 hover:border-white/20 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden sm:inline">Папка</span>
            </button>
          )}

          {/* Storage stats */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900/90 border border-white/10 text-xs">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <div>
              <span className="text-zinc-400">Збережено: </span>
              <span className="font-bold text-white font-mono">
                {formatBytes(totalCompletedBytes)}
              </span>
            </div>
          </div>

          {/* Active status pill */}
          {(activeDownloadsCount > 0 || queuedDownloadsCount > 0) && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 font-semibold">
              <RefreshCw className={cn("w-3.5 h-3.5", activeDownloadsCount > 0 && "animate-spin")} />
              <span>
                {activeDownloadsCount > 0 ? `${activeDownloadsCount} активні` : "В черзі"}
                {queuedDownloadsCount > 0 && ` • ${queuedDownloadsCount} очікують`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filter, View Switcher & Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
          {/* Section pills */}
          <div className="flex items-center gap-1.5 p-1 bg-zinc-900/80 rounded-xl border border-white/5 w-full sm:w-auto overflow-x-auto">
            {[
              { id: "all", label: "Всі" },
              { id: "movie", label: "Фільми" },
              { id: "series", label: "Серіали" },
              { id: "cartoon", label: "Мультфільми" },
              { id: "anime", label: "Аніме" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveType(tab.id as any)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer",
                  activeType === tab.id
                    ? "bg-rose-600 text-white shadow-md shadow-rose-950/40"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            {/* View Mode Toggle */}
            <div className="flex items-center p-0.5 bg-zinc-900/90 rounded-xl border border-white/10 text-xs">
              <button
                onClick={() => setIsGroupedView(true)}
                title="Групувати серіали по сезонах"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer",
                  isGroupedView
                    ? "bg-rose-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>За серіалами</span>
              </button>
              <button
                onClick={() => setIsGroupedView(false)}
                title="Показати всі серії окремо"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer",
                  !isGroupedView
                    ? "bg-rose-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Всі серії</span>
              </button>
            </div>

            {/* Search bar */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук серед завантажених..."
                className="w-full bg-zinc-900/90 border border-white/10 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Genres Pills */}
        {allGenres.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <span className="text-zinc-500 text-[11px] font-medium mr-1 flex-shrink-0">
              Жанри:
            </span>
            <button
              onClick={() => setSelectedGenre("all")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex-shrink-0",
                selectedGenre === "all"
                  ? "bg-white/20 text-white"
                  : "bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-zinc-800"
              )}
            >
              Всі
            </button>
            {allGenres.map((genre) => (
              <button
                key={genre}
                onClick={() => setSelectedGenre(genre)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex-shrink-0",
                  selectedGenre === genre
                    ? "bg-white/20 text-white"
                    : "bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-zinc-800"
                )}
              >
                {genre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid of downloads */}
      {displayItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 rounded-3xl bg-zinc-950/40 border border-white/5 p-8">
          <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center text-zinc-600 border border-white/5">
            <Download className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">
              {downloads.length === 0
                ? "У вас ще немає завантажень"
                : "За цими фільтрами нічого не знайдено"}
            </h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              {downloads.length === 0
                ? "Відкрийте будь-який фільм або серію та натисніть «Завантажити», щоб переглядати офлайн без інтернету."
                : "Спробуйте змінити пошуковий запит або скинути жанровий фільтр."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
          {displayItems.map((entry) => {
            // ==================== 1. GROUPED SERIES CARD ====================
            if (entry.type === "series") {
              const { key, group } = entry;
              const isExpanded = Boolean(expandedSeries[key]);
              const percent =
                group.totalBytes > 0
                  ? Math.min(
                      100,
                      Math.round((group.downloadedBytes / group.totalBytes) * 100)
                    )
                  : 0;

              return (
                <div
                  key={key}
                  className="group relative flex flex-col select-none focus:outline-none transition-all duration-200"
                >
                  {/* Poster Box */}
                  <div
                    onClick={(e) => toggleSeriesExpand(key, e)}
                    className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-zinc-900 border border-white/10 group-hover:border-rose-500/50 transition-all duration-200 group-hover:scale-[1.025] transform-gpu shadow-lg shadow-black/40 cursor-pointer"
                  >
                    <img
                      src={group.posterUrl}
                      alt={group.title}
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover pointer-events-none select-none transition-transform duration-300 group-hover:scale-105"
                    />

                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/25 to-transparent pointer-events-none" />

                    {/* Top-Left: Badge */}
                    <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1 items-start pointer-events-none">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide uppercase shadow-sm bg-rose-600 text-white">
                        Серіал {group.season ? `• С${group.season}` : ""}
                      </span>
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase bg-black/75 backdrop-blur-md text-zinc-300 border border-white/10 shadow-sm">
                        <Layers className="w-3 h-3 text-rose-400" />
                        <span>{group.totalCount} серій</span>
                      </span>
                    </div>

                    {/* Top-Right: Status Badge */}
                    <div className="absolute top-2.5 right-2.5 z-10 flex flex-col gap-1 items-end pointer-events-none">
                      {group.allCompleted ? (
                        <span className="flex items-center gap-1 bg-emerald-500/90 text-white backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Всі готові</span>
                        </span>
                      ) : group.downloadingCount > 0 ? (
                        <span className="flex items-center gap-1 bg-rose-600/90 text-white backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm animate-pulse">
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          <span>{percent}%</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 bg-amber-500/90 text-black backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{group.completedCount}/{group.totalCount}</span>
                        </span>
                      )}
                    </div>

                    {/* Bottom Progress Overlay */}
                    <div className="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/95 via-black/85 to-transparent z-10 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-zinc-300 font-semibold truncate max-w-[90px]">
                          {formatBytes(group.downloadedBytes)}
                        </span>
                        {group.downloadingCount > 0 ? (
                          <span className="text-emerald-400 font-bold">
                            ↓ {formatSpeed(group.speedBytesSec)}
                          </span>
                        ) : (
                          <span className="text-zinc-400 font-medium">
                            {group.completedCount} з {group.totalCount} готово
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            group.allCompleted
                              ? "bg-emerald-500"
                              : "bg-gradient-to-r from-rose-600 to-amber-400 shadow-sm shadow-rose-500/50"
                          )}
                          style={{ width: `${Math.max(3, percent)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Text details & Accordion Button below poster */}
                  <div className="mt-2.5 flex flex-col space-y-1">
                    <h4
                      title={group.title}
                      className="text-xs font-bold text-zinc-100 line-clamp-1 group-hover:text-rose-400 transition-colors"
                    >
                      {group.title}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="truncate max-w-[120px]">
                        {group.translatorName || "Оригінал"}
                      </span>
                      <button
                        onClick={(e) => toggleSeriesExpand(key, e)}
                        className="flex items-center gap-1 text-rose-400 hover:text-rose-300 font-semibold cursor-pointer transition-colors"
                      >
                        <span>{isExpanded ? "Сховати" : `${group.totalCount} серій`}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Series Drawer (Inline Accordion List) */}
                  {isExpanded && (
                    <div className="mt-3 p-2.5 rounded-2xl bg-zinc-900/90 border border-white/10 space-y-2 shadow-2xl">
                      <div className="text-[11px] font-bold text-zinc-300 pb-1 border-b border-white/5 flex items-center justify-between">
                        <span>Список серій ({group.totalCount})</span>
                        <span className="text-zinc-500 font-normal">
                          {group.season ? `Сезон ${group.season}` : ""}
                        </span>
                      </div>

                      <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                        {group.episodes.map((ep) => {
                          const epCompleted = ep.status === "completed";
                          const epDownloading = ep.status === "downloading";
                          const epPaused = ep.status === "paused";
                          const epQueued = ep.status === "queued";

                          const epPercent =
                            ep.total_bytes > 0
                              ? Math.min(
                                  100,
                                  Math.round((ep.downloaded_bytes / ep.total_bytes) * 100)
                                )
                              : 0;

                          return (
                            <div
                              key={ep.id}
                              className="p-2 rounded-xl bg-zinc-950/60 hover:bg-zinc-950 border border-white/5 flex items-center justify-between gap-2 text-xs transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-white px-1.5 py-0.5 rounded bg-zinc-800 text-[10px]">
                                  E{ep.episode || "?"}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 text-[10px]">
                                    {epCompleted ? (
                                      <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                                        <CheckCircle2 className="w-2.5 h-2.5" /> Готово
                                      </span>
                                    ) : epDownloading ? (
                                      <span className="text-rose-400 font-semibold flex items-center gap-0.5">
                                        <RefreshCw className="w-2.5 h-2.5 animate-spin" /> {epPercent}%
                                      </span>
                                    ) : epQueued ? (
                                      <span className="text-amber-400 font-semibold flex items-center gap-0.5">
                                        <Clock className="w-2.5 h-2.5" /> В черзі
                                      </span>
                                    ) : (
                                      <span className="text-zinc-400">Пауза</span>
                                    )}
                                    <span className="text-zinc-500">•</span>
                                    <span className="text-zinc-400">
                                      {formatBytes(ep.downloaded_bytes)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Episode Action Buttons */}
                              <div className="flex items-center gap-1 shrink-0">
                                {epCompleted && (
                                  <>
                                    <button
                                      onClick={() => onPlayDownload(ep)}
                                      title="Дивитися"
                                      className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white cursor-pointer shadow-sm"
                                    >
                                      <Play className="w-3 h-3 fill-white" />
                                    </button>
                                    <button
                                      onClick={(e) => handleShowInFolder(ep.file_path, e)}
                                      title="Показати у системній папці"
                                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
                                    >
                                      <FolderOpen className="w-3 h-3" />
                                    </button>
                                  </>
                                )}

                                {epDownloading && (
                                  <button
                                    onClick={(e) => handlePause(ep.id, e)}
                                    title="Призупинити"
                                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
                                  >
                                    <Pause className="w-3 h-3" />
                                  </button>
                                )}

                                {epPaused && (
                                  <button
                                    onClick={(e) => handleResume(ep.id, e)}
                                    title="Продовжити"
                                    className="p-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white cursor-pointer"
                                  >
                                    <Play className="w-3 h-3 fill-white" />
                                  </button>
                                )}

                                <button
                                  onClick={(e) =>
                                    epCompleted
                                      ? handleDelete(ep.id, `Епізод E${ep.episode}`, e)
                                      : handleCancel(ep.id, e)
                                  }
                                  title={epCompleted ? "Видалити файл" : "Скасувати"}
                                  className="p-1.5 rounded-lg hover:bg-rose-500/10 text-zinc-500 hover:text-rose-400 cursor-pointer"
                                >
                                  {epCompleted ? (
                                    <Trash2 className="w-3 h-3" />
                                  ) : (
                                    <X className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // ==================== 2. SINGLE DOWNLOAD CARD (Movie or Flat Mode) ====================
            const item = entry.item;
            const isCompleted = item.status === "completed";
            const isDownloading = item.status === "downloading";
            const isPaused = item.status === "paused";
            const isError = item.status === "error";

            const percent =
              item.total_bytes > 0
                ? Math.min(
                    100,
                    Math.round((item.downloaded_bytes / item.total_bytes) * 100)
                  )
                : 0;

            const isPrem = isPremiumQuality(item.quality);

            const entityType = (item.media_type || "").toLowerCase();
            let typeLabel = "Фільм";
            let typeBadgeClass = "bg-indigo-600 text-white";
            if (entityType.includes("series") || entityType.includes("серіал") || item.season != null) {
              typeLabel = "Серіал";
              typeBadgeClass = "bg-rose-600 text-white";
            } else if (entityType.includes("anime") || entityType.includes("аніме")) {
              typeLabel = "Аніме";
              typeBadgeClass = "bg-purple-600 text-white";
            } else if (entityType.includes("cartoon") || entityType.includes("мульт")) {
              typeLabel = "Мультфільм";
              typeBadgeClass = "bg-emerald-600 text-white";
            }

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isCompleted) {
                    onPlayDownload(item);
                  }
                }}
                className={cn(
                  "group relative flex flex-col select-none focus:outline-none transition-all duration-200",
                  isCompleted ? "cursor-pointer" : "cursor-default"
                )}
              >
                {/* 2:3 Vertical Poster Container */}
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-zinc-900 border border-white/10 group-hover:border-rose-500/50 transition-all duration-200 group-hover:scale-[1.025] transform-gpu shadow-lg shadow-black/40">
                  <img
                    src={item.poster_url}
                    alt={item.title}
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover pointer-events-none select-none transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      (e.currentTarget as HTMLImageElement).src =
                        "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22200%22%20height%3D%22300%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20fill%3D%22%2318181b%22%20width%3D%22200%22%20height%3D%22300%22%20%2F%3E%3Ctext%20fill%3D%22%2371717a%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3ERDX%3C%2Ftext%3E%3C%2Fsvg%3E";
                    }}
                  />

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent pointer-events-none" />

                  {/* Top-Left Badges: Entity Type & Quality with Crown */}
                  <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1 items-start pointer-events-none">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide uppercase shadow-sm",
                        typeBadgeClass
                      )}
                    >
                      {typeLabel}
                    </span>
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-black tracking-wide uppercase bg-black/75 backdrop-blur-md text-zinc-200 border border-white/10 shadow-sm">
                      <span>{item.quality}</span>
                      {isPrem && <Crown className="w-3 h-3 text-amber-400 fill-amber-400/25 flex-shrink-0" />}
                    </span>
                  </div>

                  {/* Top-Right Badges: Season/Episode & Status */}
                  <div className="absolute top-2.5 right-2.5 z-10 flex flex-col gap-1 items-end pointer-events-none">
                    {item.season != null && item.episode != null && (
                      <span className="bg-zinc-950/90 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold text-white border border-white/10 shadow-sm">
                        S{item.season}E{item.episode}
                      </span>
                    )}
                    {isCompleted ? (
                      <span className="flex items-center gap-1 bg-emerald-500/90 text-white backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Готово</span>
                      </span>
                    ) : isDownloading ? (
                      <span className="flex items-center gap-1 bg-rose-600/90 text-white backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm animate-pulse">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        <span>{percent}%</span>
                      </span>
                    ) : item.status === "queued" ? (
                      <span className="flex items-center gap-1 bg-amber-500/90 text-black backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm">
                        <Clock className="w-2.5 h-2.5" />
                        <span>В черзі</span>
                      </span>
                    ) : isPaused ? (
                      <span className="bg-zinc-800/90 text-zinc-300 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold border border-white/10">
                        Пауза
                      </span>
                    ) : isError ? (
                      <span className="bg-red-600/90 text-white backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold">
                        Помилка
                      </span>
                    ) : null}
                  </div>

                  {/* Center Hover Action for Completed: Big Play Button */}
                  {isCompleted && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10 pointer-events-none">
                      <div className="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-xl shadow-rose-950/60 group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5 fill-white ml-0.5" />
                      </div>
                    </div>
                  )}

                  {/* Active Download Progress Bar & Speed Overlay at bottom of poster */}
                  {!isCompleted && (
                    <div className="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/95 via-black/85 to-transparent z-10 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-zinc-300 font-semibold truncate max-w-[80px]">
                          {formatBytes(item.downloaded_bytes)}
                        </span>
                        {isDownloading && (
                          <div className="flex items-center gap-1">
                            {getEtaString(item.downloaded_bytes, item.total_bytes, item.speed_bytes_sec) && (
                              <span className="text-zinc-400 font-normal">
                                {getEtaString(item.downloaded_bytes, item.total_bytes, item.speed_bytes_sec)}
                              </span>
                            )}
                            <span className="text-emerald-400 font-bold">
                              ↓ {formatSpeed(item.speed_bytes_sec)}
                            </span>
                          </div>
                        )}
                        {item.status === "queued" && (
                          <span className="text-amber-400 font-medium">Очікує черги...</span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            isDownloading && "bg-gradient-to-r from-rose-600 to-amber-400 shadow-sm shadow-rose-500/50",
                            item.status === "queued" && "bg-amber-500/60",
                            isPaused && "bg-zinc-500",
                            isError && "bg-red-600"
                          )}
                          style={{ width: `${Math.max(3, percent)}%` }}
                        />
                      </div>

                      {/* Controls */}
                      <div className="flex items-center justify-between pt-0.5">
                        <div className="flex items-center gap-1">
                          {isDownloading && (
                            <button
                              onClick={(e) => handlePause(item.id, e)}
                              title="Призупинити"
                              className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 text-zinc-200 text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Pause className="w-2.5 h-2.5" />
                              <span>Пауза</span>
                            </button>
                          )}
                          {(isPaused || isError) && (
                            <button
                              onClick={(e) => handleResume(item.id, e)}
                              title="Продовжити"
                              className="px-2 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                            >
                              <Play className="w-2.5 h-2.5 fill-white" />
                              <span>Старт</span>
                            </button>
                          )}
                        </div>

                        <button
                          onClick={(e) => handleCancel(item.id, e)}
                          title="Скасувати та видалити"
                          className="p-1 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Text details below poster */}
                <div className="mt-2.5 flex flex-col space-y-1">
                  <div className="flex items-start justify-between gap-1.5">
                    <h4
                      title={item.title}
                      className="text-xs font-bold text-zinc-100 line-clamp-1 group-hover:text-rose-400 transition-colors"
                    >
                      {item.title}
                    </h4>

                    {/* Action buttons for completed */}
                    {isCompleted && (
                      <div className="flex items-center gap-0.5 -mr-1 shrink-0">
                        <button
                          onClick={(e) => handleShowInFolder(item.file_path, e)}
                          title="Показати у папці"
                          className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(item.id, item.title, e)}
                          title="Видалити файл із диску"
                          className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="truncate max-w-[120px]">
                      {item.translator_name || "Оригінал"}
                    </span>
                    {item.season != null && item.episode != null ? (
                      <span className="text-zinc-500 text-[10px] font-mono">
                        S{item.season}:E{item.episode}
                      </span>
                    ) : (
                      <span className="text-zinc-500 text-[10px] font-mono">
                        {formatBytes(item.total_bytes || item.downloaded_bytes)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
