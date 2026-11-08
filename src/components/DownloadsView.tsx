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
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../services/api";
import { cn } from "../lib/utils";
import type { DownloadItem, DownloadProgressEvent } from "../types";

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

    // Listen to real-time progress events from Rust
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;

    listen<DownloadProgressEvent>("download://progress", (event) => {
      const payload = event.payload;
      setDownloads((prev) =>
        prev.map((item) => {
          if (item.id === payload.id) {
            return {
              ...item,
              downloaded_bytes: payload.downloaded_bytes,
              total_bytes: payload.total_bytes,
              speed_bytes_sec: payload.speed_bytes_sec,
              status: payload.status as any,
            };
          }
          return item;
        })
      );
    }).then((un) => {
      unlistenProgress = un;
    });

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
    });

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
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
    if (!bytesSec || bytesSec <= 0) return "";
    const mb = bytesSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} МБ/с`;
    const kb = bytesSec / 1024;
    return `${kb.toFixed(0)} КБ/с`;
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
      // Type filter
      if (activeType !== "all") {
        if (activeType === "movie" && d.media_type !== "movie") return false;
        if (activeType === "series" && d.media_type !== "series") return false;
        if (activeType === "cartoon" && d.media_type !== "cartoon") return false;
        if (activeType === "anime" && d.media_type !== "anime") return false;
      }

      // Genre filter
      if (selectedGenre !== "all") {
        if (!d.genres || !d.genres.toLowerCase().includes(selectedGenre.toLowerCase())) {
          return false;
        }
      }

      // Search query
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

  const activeDownloadsCount = useMemo(() => {
    return downloads.filter(
      (d) => d.status === "downloading" || d.status === "queued"
    ).length;
  }, [downloads]);

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

        {/* Stats & Folder info */}
        <div className="flex flex-wrap items-center gap-3">
          {downloadsDir && (
            <div
              title={downloadsDir}
              className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900/60 border border-white/5 text-[11px] text-zinc-400 max-w-xs truncate"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
              <span className="truncate">{downloadsDir}</span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900/90 border border-white/10 text-xs">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <div>
              <span className="text-zinc-400">Збережено: </span>
              <span className="font-bold text-white font-mono">
                {formatBytes(totalCompletedBytes)}
              </span>
            </div>
          </div>

          {activeDownloadsCount > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 font-semibold animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{activeDownloadsCount} активних</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
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

          {/* Search bar */}
          <div className="relative w-full sm:w-72">
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
      {filteredDownloads.length === 0 ? (
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredDownloads.map((item) => {
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

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isCompleted) {
                    onPlayDownload(item);
                  }
                }}
                className={cn(
                  "group relative flex flex-col rounded-2xl bg-zinc-900/80 border border-white/10 overflow-hidden transition-all duration-200",
                  isCompleted
                    ? "hover:border-rose-500/50 hover:shadow-xl hover:shadow-rose-950/20 cursor-pointer"
                    : "cursor-default"
                )}
              >
                {/* Poster & Badges Header */}
                <div className="relative aspect-video w-full bg-zinc-950 overflow-hidden flex items-center justify-center">
                  <img
                    src={item.poster_url}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/30 to-transparent" />

                  {/* Quality Badge */}
                  <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-rose-600/90 text-white backdrop-blur-md shadow-sm">
                    {item.quality}
                  </span>

                  {/* Series Season/Episode Badge */}
                  {item.season != null && item.episode != null && (
                    <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-900/80 text-zinc-300 border border-white/10 backdrop-blur-md">
                      S{item.season} E{item.episode}
                    </span>
                  )}

                  {/* Play Action Overlay for completed files */}
                  {isCompleted && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px]">
                      <div className="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-600/50 group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5 fill-white ml-0.5" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Content details */}
                <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-white line-clamp-1 group-hover:text-rose-400 transition-colors">
                      {item.title}
                    </h4>
                    {item.orig_title && (
                      <p className="text-[11px] text-zinc-400 line-clamp-1">
                        {item.orig_title}
                      </p>
                    )}
                    <p className="text-[11px] text-zinc-500 font-medium truncate">
                      🎙️ {item.translator_name}
                    </p>
                  </div>

                  {/* Progress status for in-progress or paused */}
                  {!isCompleted && (
                    <div className="space-y-2 pt-1 border-t border-white/5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={cn(
                            "font-semibold",
                            isDownloading && "text-amber-400",
                            isPaused && "text-zinc-400",
                            isError && "text-rose-400"
                          )}
                        >
                          {isDownloading && "Завантаження..."}
                          {isPaused && "Призупинено"}
                          {isError && (item.error_message || "Помилка")}
                        </span>
                        <span className="font-mono text-zinc-400">
                          {percent}%
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all duration-300",
                            isDownloading && "bg-rose-500",
                            isPaused && "bg-zinc-500",
                            isError && "bg-red-600"
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                        <span>
                          {formatBytes(item.downloaded_bytes)} /{" "}
                          {formatBytes(item.total_bytes)}
                        </span>
                        {isDownloading && item.speed_bytes_sec ? (
                          <span className="text-emerald-400 font-bold">
                            {formatSpeed(item.speed_bytes_sec)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {/* Card actions bottom bar */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs">
                    {isCompleted ? (
                      <>
                        <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Завантажено</span>
                          <span className="text-zinc-500 font-normal font-mono text-[10px] ml-1">
                            ({formatBytes(item.total_bytes || item.downloaded_bytes)})
                          </span>
                        </div>
                        <button
                          onClick={(e) => handleDelete(item.id, item.title, e)}
                          title="Видалити файл"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          {isDownloading && (
                            <button
                              onClick={(e) => handlePause(item.id, e)}
                              title="Призупинити"
                              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Pause className="w-3 h-3" />
                              <span>Пауза</span>
                            </button>
                          )}
                          {(isPaused || isError) && (
                            <button
                              onClick={(e) => handleResume(item.id, e)}
                              title="Продовжити завантаження"
                              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                            >
                              <Play className="w-3 h-3 fill-white" />
                              <span>Продовжити</span>
                            </button>
                          )}
                        </div>

                        <button
                          onClick={(e) => handleCancel(item.id, e)}
                          title="Скасувати та видалити"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
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
