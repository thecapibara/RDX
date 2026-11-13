import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Play,
  Bookmark as BookmarkIcon,
  Star,
  Loader2,
  ChevronDown,
  Check,
  Search,
  Info,
  Clock,
  Crown,
  Download,
  X,
  Mic,
  Layers,
} from "lucide-react";
import type { Bookmark, MediaCard, MediaDetails, WatchProgress, Translator, EpisodeProgress, StreamQuality } from "../types";
import { api } from "../services/api";
import { cn } from "../lib/utils";
import { playModalOpenSound, suppressHoverSound } from "../services/sound";
import { openDownloadsTab } from "../services/downloadsStore";
import { WindowControls } from "./WindowControls";

interface MediaDetailsModalProps {
  media: MediaCard | null;
  isOpen: boolean;
  onClose: () => void;
  onPlay: (
    details: MediaDetails,
    translatorId?: string,
    season?: number,
    episode?: number,
    initialPositionSec?: number
  ) => void;
  isBookmarked: boolean;
  onToggleBookmark: (bookmark: Bookmark) => void;
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

export const MediaDetailsModal: React.FC<MediaDetailsModalProps> = ({
  media,
  isOpen,
  onClose,
  onPlay,
  isBookmarked,
  onToggleBookmark,
}) => {
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [savedProgress, setSavedProgress] = useState<WatchProgress | null>(null);
  const [episodeProgressList, setEpisodeProgressList] = useState<EpisodeProgress[]>([]);
  const [selectedTranslator, setSelectedTranslator] = useState<Translator | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [tmdbBackdrop, setTmdbBackdrop] = useState<string | null>(null);

  // Helper to determine effective bookmark category based on watch progress
  const getBookmarkCategory = (): string => {
    if (
      savedProgress &&
      savedProgress.duration_sec > 0 &&
      savedProgress.position_sec / savedProgress.duration_sec >= 0.9
    ) {
      return "completed";
    }
    if (savedProgress && savedProgress.position_sec > 15) {
      return "watching";
    }
    return "planned";
  };
  const [maxKnownSeasons, setMaxKnownSeasons] = useState<number>(1);

  // Download states
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [downloadMode, setDownloadMode] = useState<"single" | "season" | "all_seasons" | "custom">("single");
  const [downloadTargetSeason, setDownloadTargetSeason] = useState<number>(1);
  const [customSeasonTab, setCustomSeasonTab] = useState<number>(1);
  const [selectedCustomEpisodes, setSelectedCustomEpisodes] = useState<Set<string>>(new Set());
  const [downloadTranslator, setDownloadTranslator] = useState<Translator | null>(null);
  const [isDownloadTranslatorDropdownOpen, setIsDownloadTranslatorDropdownOpen] = useState(false);
  const [downloadQualities, setDownloadQualities] = useState<StreamQuality[]>([]);
  const [selectedDownloadQuality, setSelectedDownloadQuality] = useState<string>("720p");
  const [loadingQualities, setLoadingQualities] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState<string | null>(null);
  const downloadTranslatorDropdownRef = useRef<HTMLDivElement>(null);

  // Dropdown states for structured voiceover selector
  const [isTranslatorDropdownOpen, setIsTranslatorDropdownOpen] = useState(false);
  const [translatorFilterTab, setTranslatorFilterTab] = useState<"all" | "ukr">("all");
  const [translatorSearch, setTranslatorSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close download translator dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        downloadTranslatorDropdownRef.current &&
        !downloadTranslatorDropdownRef.current.contains(e.target as Node)
      ) {
        setIsDownloadTranslatorDropdownOpen(false);
      }
    };
    if (isDownloadTranslatorDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDownloadTranslatorDropdownOpen]);

  // Close translator dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsTranslatorDropdownOpen(false);
      }
    };
    if (isTranslatorDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isTranslatorDropdownOpen]);

  const handleClose = () => {
    suppressHoverSound(400);
    onClose();
  };

  // Fetch crisp widescreen TMDB backdrop for the header
  useEffect(() => {
    if (!isOpen || !media) {
      setTmdbBackdrop(null);
      return;
    }
    let mounted = true;
    const title = details?.title || media.title;
    const origTitle = details?.orig_title || (media as any).orig_title;
    const yearFromTable = details?.info_table?.find(([k]) => {
      const lower = k.toLowerCase();
      return lower.includes("рік") || lower.includes("год");
    })?.[1];
    const yearMatch = (yearFromTable || media.misc_info || "").match(/\b(19\d\d|20\d\d)\b/)?.[0];
    const isSer =
      Boolean(details?.seasons && details.seasons.length > 0) ||
      Boolean(media.entity_type?.toLowerCase().includes("серіал")) ||
      Boolean(media.entity_type?.toLowerCase().includes("сериал")) ||
      media.url.includes("/series/");
    const mediaType: "movie" | "tv" = isSer ? "tv" : "movie";

    api.getBackdrop(title, origTitle, yearMatch, mediaType).then((url) => {
      if (mounted && url) {
        setTmdbBackdrop(url);
      }
    });
    return () => {
      mounted = false;
    };
  }, [isOpen, media?.id, media?.url, details?.title, details?.orig_title, details?.seasons?.length]);

  useEffect(() => {
    if (isOpen) {
      playModalOpenSound();
    }
  }, [isOpen]);

  // Keyboard shortcut: Escape to close modal (or close dropdown if open)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[data-player-mode="full"]')) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (isTranslatorDropdownOpen) {
          setIsTranslatorDropdownOpen(false);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isTranslatorDropdownOpen]);

  useEffect(() => {
    if (!isOpen || !media) {
      setDetails(null);
      setSavedProgress(null);
      setEpisodeProgressList([]);
      setSelectedTranslator(null);
      setIsTranslatorDropdownOpen(false);
      setFetchError(null);
      setMaxKnownSeasons(1);
      return;
    }

    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const [det, initialProgress, initialEpProgress] = await Promise.all([
          api.getMediaDetails(media.url),
          media.id ? api.getWatchProgress(media.id).catch(() => null) : Promise.resolve(null),
          media.id ? api.getEpisodeProgress(media.id).catch(() => []) : Promise.resolve([]),
        ]);

        if (!isMounted) return;

        // Fall back to det.id (parsed from canonical page URL) if media.id was empty or differed
        let progress = initialProgress;
        let epProgress = initialEpProgress || [];
        if (det.id && det.id !== media.id) {
          if (!progress) {
            progress = await api.getWatchProgress(det.id).catch(() => null);
          }
          if (epProgress.length === 0) {
            epProgress = await api.getEpisodeProgress(det.id).catch(() => []);
          }
          if (!isMounted) return;
        }

        // Check if media.series_info hints at higher season count (e.g. "8 сезон 10 серія" or "S08E10")
        let hintedMax = det.seasons.length;
        if (media.series_info) {
          const m1 = media.series_info.match(/(\d+)\s*сезон/i);
          const m2 = media.series_info.match(/s(\d+)/i);
          if (m1) hintedMax = Math.max(hintedMax, parseInt(m1[1], 10) || 1);
          if (m2) hintedMax = Math.max(hintedMax, parseInt(m2[1], 10) || 1);
        }
        setMaxKnownSeasons(hintedMax);

        // Determine default translator
        let defaultT: Translator | null = null;
        if (det.translators && det.translators.length > 0) {
          const savedT = progress?.translator_id
            ? det.translators.find((t) => t.id === progress.translator_id)
            : null;

          const ukrT = det.translators.find((t) =>
            t.language?.toLowerCase().includes("украин") ||
            t.language?.toLowerCase().includes("україн")
          );

          defaultT = savedT || ukrT || det.translators.find((t) => t.is_active) || det.translators[0];
          setSelectedTranslator(defaultT);
        }

        // Display details immediately (cuts initial load wait in half)
        setDetails(det);
        setSavedProgress(progress);
        setEpisodeProgressList(epProgress || []);
        setLoading(false);

        // Default season & episode
        if (progress?.season) {
          const seasonExists = det.seasons.some((s) => parseInt(s.id, 10) === progress.season);
          if (seasonExists) {
            setSelectedSeason(progress.season);
          } else if (det.seasons.length > 0) {
            const firstS = parseInt(det.seasons[0].id, 10);
            setSelectedSeason(isNaN(firstS) ? 1 : firstS);
          }
        } else if (det.seasons && det.seasons.length > 0) {
          const firstSeasonNum = parseInt(det.seasons[0].id, 10);
          setSelectedSeason(isNaN(firstSeasonNum) ? 1 : firstSeasonNum);
        }

        if (progress?.episode) {
          setSelectedEpisode(progress.episode);
        } else {
          setSelectedEpisode(1);
        }

        // If series, fetch translator-specific episode matrix asynchronously without blocking UI
        if (det.seasons && det.seasons.length > 0 && defaultT) {
          setLoadingEpisodes(true);
          api.getEpisodes(det.id, defaultT.id, det.url)
            .then((epData) => {
              if (isMounted && epData.episodes && epData.episodes.length > 0) {
                if (epData.seasons.length > 0) {
                  setMaxKnownSeasons((prev) => Math.max(prev, epData.seasons.length));
                }
                setDetails((prev) =>
                  prev
                    ? {
                        ...prev,
                        seasons: epData.seasons.length > 0 ? epData.seasons : prev.seasons,
                        episodes: epData.episodes,
                        initial_streams: epData.stream_data || prev.initial_streams,
                      }
                    : prev
                );
              }
            })
            .catch((epErr) => {
              console.warn("Failed to load initial episodes for default translator:", epErr);
            })
            .finally(() => {
              if (isMounted) setLoadingEpisodes(false);
            });
        }
      } catch (err) {
        console.error("Failed to load media details:", err);
        if (isMounted) {
          setFetchError("Не вдалося завантажити інформацію про цей фільм. Перевірте дзеркало в налаштуваннях.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, media]);

  // When translator changes for a series, fetch updated seasons & episodes
  const handleTranslatorSelect = async (translator: Translator) => {
    setSelectedTranslator(translator);
    setIsTranslatorDropdownOpen(false);
    if (!details || details.seasons.length === 0) return;

    setLoadingEpisodes(true);
    try {
      const data = await api.getEpisodes(details.id, translator.id, details.url);
      if (data.seasons.length > 0) {
        setMaxKnownSeasons((prev) => Math.max(prev, data.seasons.length));
      }
      setDetails((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          seasons: data.seasons,
          episodes: data.episodes,
          initial_streams: data.stream_data || prev.initial_streams,
        };
      });

      // If currently selectedSeason is not available in the new translator's seasons, switch to the first season
      const seasonExists = data.seasons.some(
        (s) => parseInt(s.id, 10) === selectedSeason
      );
      if (!seasonExists && data.seasons.length > 0) {
        const firstSeason = parseInt(data.seasons[0].id, 10);
        setSelectedSeason(isNaN(firstSeason) ? 1 : firstSeason);
        setSelectedEpisode(1);
      }
    } catch (e) {
      console.error("Failed to update episodes for translator:", e);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  if (!isOpen || !media) return null;

  const isSeries = details
    ? Boolean(details.seasons && details.seasons.length > 0)
    : Boolean(
        media.series_info ||
        media.entity_type?.toLowerCase().includes("series") ||
        media.entity_type?.toLowerCase().includes("сериал") ||
        media.entity_type?.toLowerCase().includes("серіал")
      );

  // Episodes for current selected season
  const currentSeasonEpisodes =
    details?.episodes.filter(
      (ep) => Number(ep.season_id) === Number(selectedSeason)
    ) || [];

  // Check if media is actually available to stream (or is an upcoming unreleased title "В очікуванні")
  const hasAvailableStream = Boolean(
    (details?.translators && details.translators.length > 0) ||
    (details?.initial_streams && details.initial_streams.qualities.length > 0) ||
    (details?.episodes && details.episodes.length > 0)
  );

  const handleStartPlayback = (season?: number, ep?: number) => {
    if (!details) return;

    const playSeason = season ?? selectedSeason;
    const playEp = ep ?? selectedEpisode;

    const epProg = isSeries
      ? episodeProgressList.find(
          (p) => p.season === playSeason && p.episode === playEp
        )
      : null;

    let initialPos = 0;
    if (epProg && epProg.duration_sec > 0) {
      const pct = (epProg.position_sec / epProg.duration_sec) * 100;
      if (pct < 90) {
        initialPos = epProg.position_sec;
      }
    } else if (
      savedProgress &&
      (!isSeries ||
        (savedProgress.season === playSeason &&
          savedProgress.episode === playEp))
    ) {
      initialPos = savedProgress.position_sec;
    }

    onPlay(
      details,
      selectedTranslator?.id,
      isSeries ? playSeason : undefined,
      isSeries ? playEp : undefined,
      initialPos
    );
  };

  const handleOpenDownloadModal = async () => {
    if (!details) return;
    setIsDownloadModalOpen(true);
    setDownloadMode("single");
    setDownloadTargetSeason(selectedSeason);
    setCustomSeasonTab(selectedSeason);
    setSelectedCustomEpisodes(new Set([`${selectedSeason}_${selectedEpisode}`]));
    setDownloadTranslator(selectedTranslator);
    setIsDownloadTranslatorDropdownOpen(false);
    setLoadingQualities(true);
    try {
      const stream = await api.getStream(
        details.id,
        details.url,
        isSeries,
        selectedTranslator?.id,
        isSeries ? selectedSeason : undefined,
        isSeries ? selectedEpisode : undefined
      );
      if (stream && stream.qualities.length > 0) {
        setDownloadQualities(stream.qualities);
        const preferred =
          stream.qualities.find((q) => q.label === "1080p") ||
          stream.qualities.find((q) => q.label === "720p") ||
          stream.qualities[0];
        setSelectedDownloadQuality(preferred.label);
      }
    } catch (err) {
      console.error("Failed to load stream qualities for download:", err);
    } finally {
      setLoadingQualities(false);
    }
  };

  const handleDownloadTranslatorChange = async (translator: Translator) => {
    setDownloadTranslator(translator);
    setIsDownloadTranslatorDropdownOpen(false);
    setLoadingQualities(true);
    try {
      if (isSeries && details) {
        const data = await api.getEpisodes(details.id, translator.id, details.url);
        if (data.seasons.length > 0) {
          setMaxKnownSeasons((prev) => Math.max(prev, data.seasons.length));
        }
        setDetails((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            seasons: data.seasons,
            episodes: data.episodes,
            initial_streams: data.stream_data || prev.initial_streams,
          };
        });

        // Ensure downloadTargetSeason exists in new translator's seasons
        const sExists = data.seasons.some((s) => Number(s.id) === Number(downloadTargetSeason));
        if (!sExists && data.seasons.length > 0) {
          const firstS = Number(data.seasons[0].id) || 1;
          setDownloadTargetSeason(firstS);
        }
      }

      if (details) {
        const stream = await api.getStream(
          details.id,
          details.url,
          isSeries,
          translator.id,
          isSeries ? downloadTargetSeason : undefined,
          isSeries ? selectedEpisode : undefined
        );

        if (stream && stream.qualities.length > 0) {
          setDownloadQualities(stream.qualities);
          const exists = stream.qualities.some((q) => q.label === selectedDownloadQuality);
          if (!exists) {
            const preferred =
              stream.qualities.find((q) => q.label === "1080p") ||
              stream.qualities.find((q) => q.label === "720p") ||
              stream.qualities[0];
            setSelectedDownloadQuality(preferred.label);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load stream qualities for translator:", err);
    } finally {
      setLoadingQualities(false);
    }
  };

  const handleStartDownload = async () => {
    if (!details) return;
    setIsDownloadModalOpen(false);

    const genres = details.info_table?.find((t) => t[0].toLowerCase().includes("жанр"))?.[1] || "";
    const activeTranslator = downloadTranslator || selectedTranslator;
    const translatorId = activeTranslator?.id || "default";
    const translatorName = activeTranslator?.name || "Оригінал / За замовчуванням";

    try {
      if (!isSeries || downloadMode === "single") {
        const targetQ = downloadQualities.find((q) => q.label === selectedDownloadQuality) || downloadQualities[0];
        const streamUrl = targetQ?.mp4_url || targetQ?.hls_url;
        if (!streamUrl) {
          setDownloadNotification("⚠️ Не вдалося отримати посилання на відео");
          setTimeout(() => setDownloadNotification(null), 3000);
          return;
        }

        await api.startDownload({
          mediaId: details.id,
          mediaUrl: details.url,
          title: details.title,
          origTitle: details.orig_title || undefined,
          posterUrl: details.poster,
          mediaType: isSeries ? "series" : "movie",
          genres,
          translatorId,
          translatorName,
          season: isSeries ? downloadTargetSeason : undefined,
          episode: isSeries ? selectedEpisode : undefined,
          quality: selectedDownloadQuality,
          streamUrl,
        });

        setDownloadNotification(
          isSeries
            ? `Додано в завантаження: S${downloadTargetSeason}E${selectedEpisode} (${selectedDownloadQuality})`
            : `Додано в завантаження: ${details.title} (${selectedDownloadQuality})`
        );
        setTimeout(() => setDownloadNotification(null), 4000);
      } else {
        // Multi-episode download: custom selection, specific season, or all seasons
        let episodesToDownload: typeof details.episodes = [];
        if (downloadMode === "custom") {
          episodesToDownload = details.episodes.filter((ep) =>
            selectedCustomEpisodes.has(`${ep.season_id}_${ep.episode_id}`)
          );
        } else if (downloadMode === "all_seasons") {
          episodesToDownload = details.episodes;
        } else {
          episodesToDownload = details.episodes.filter(
            (ep) => Number(ep.season_id) === Number(downloadTargetSeason)
          );
        }

        if (episodesToDownload.length === 0) {
          setDownloadNotification("⚠️ Не вибрано жодної серії для завантаження");
          setTimeout(() => setDownloadNotification(null), 3000);
          return;
        }

        setDownloadNotification(
          downloadMode === "custom"
            ? `Черга: запуск завантаження ${episodesToDownload.length} вибраних серій...`
            : downloadMode === "all_seasons"
            ? `Черга: запуск завантаження ${episodesToDownload.length} серій усіх ${details.seasons.length} сезонів...`
            : `Черга: запуск завантаження ${episodesToDownload.length} серій ${downloadTargetSeason} сезону...`
        );

        (async () => {
          let count = 0;
          for (const ep of episodesToDownload) {
            try {
              const sNum = Number(ep.season_id);
              const epNum = Number(ep.episode_id);
              const stream = await api.getStream(
                details.id,
                details.url,
                true,
                activeTranslator?.id,
                sNum,
                epNum
              );
              const targetQ =
                stream.qualities.find((q) => q.label === selectedDownloadQuality) ||
                stream.qualities.find((q) => q.label === "720p") ||
                stream.qualities[0];
              const streamUrl = targetQ?.mp4_url || targetQ?.hls_url;
              if (streamUrl) {
                await api.startDownload({
                  mediaId: details.id,
                  mediaUrl: details.url,
                  title: details.title,
                  origTitle: details.orig_title || undefined,
                  posterUrl: details.poster,
                  mediaType: "series",
                  genres,
                  translatorId,
                  translatorName,
                  season: sNum,
                  episode: epNum,
                  quality: targetQ.label,
                  streamUrl,
                });
                count++;
              }
            } catch (e) {
              console.error(`Failed to queue S${ep.season_id}E${ep.episode_id}:`, e);
            }
          }
          setDownloadNotification(
            downloadMode === "custom"
              ? `Усі ${count} вибраних серій додано до черги завантажень!`
              : downloadMode === "all_seasons"
              ? `Усі ${count} серій усіх сезонів додано до черги завантажень!`
              : `Усі ${count} серій ${downloadTargetSeason} сезону додано до черги завантажень!`
          );
          setTimeout(() => setDownloadNotification(null), 4000);
        })();
      }
    } catch (err: any) {
      console.error("Failed to start download:", err);
      setDownloadNotification(`Помилка: ${err?.message || "не вдалося завантажити"}`);
      setTimeout(() => setDownloadNotification(null), 4000);
    }
  };

  // Ukrainian translators list
  const ukrTranslators =
    details?.translators.filter(
      (t) =>
        t.language?.toLowerCase().includes("украин") ||
        t.language?.toLowerCase().includes("україн")
    ) || [];

  // Filtered translators for dropdown (prioritizing Ukrainian dubs at the top)
  const filteredTranslators = (() => {
    if (!details?.translators) return [];
    let list = [...details.translators];
    if (translatorSearch.trim()) {
      const q = translatorSearch.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => {
      const aUkr = a.language?.toLowerCase().includes("украин") || a.language?.toLowerCase().includes("україн");
      const bUkr = b.language?.toLowerCase().includes("украин") || b.language?.toLowerCase().includes("україн");
      if (aUkr && !bUkr) return -1;
      if (!aUkr && bUkr) return 1;
      return 0;
    });
  })();

  return (
    <div
      data-modal-open="true"
      className="fixed inset-0 z-50 bg-[var(--bg-base,#000000)] overflow-y-auto overflow-x-hidden select-none transition-colors duration-250"
    >
      {/* Top Window Drag Strip */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 h-14 z-30 pointer-events-auto"
      />

      {/* Top Floating Back Button */}
      <button
        onClick={handleClose}
        className="fixed top-5 left-6 sm:left-10 lg:left-14 z-40 flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-950/75 hover:bg-zinc-900 text-zinc-300 hover:text-white border border-white/15 backdrop-blur-md transition-all shadow-2xl active:scale-95 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-xs font-semibold">Назад</span>
      </button>

      {/* Top Right Frameless Window Controls */}
      <div className="fixed top-5 right-6 sm:right-8 z-40 px-1.5 py-1 rounded-xl bg-zinc-950/70 border border-white/10 backdrop-blur-md shadow-2xl">
        <WindowControls />
      </div>

      {/* Full Modal Layout (Rendered INSTANTLY with ambient backdrop and poster) */}
      <div className="relative w-full">
        {/* Full-Bleed Atmospheric Backdrop (Crisp TMDB Widescreen or Soft Poster Fallback) */}
        <div className="relative w-full h-[55vh] min-h-[420px] max-h-[620px] overflow-hidden pointer-events-none transform-gpu [isolation:isolate]">
          <img
            src={tmdbBackdrop || details?.high_res_poster || details?.poster || media.poster}
            alt={details?.title || media.title}
            decoding="async"
            className={cn(
              "w-full h-full object-cover transform-gpu transition-all duration-500",
              tmdbBackdrop
                ? "object-center opacity-80 sm:opacity-85"
                : "object-[center_20%] sm:object-[75%_20%] opacity-55 sm:opacity-60 scale-105 blur-[6px] sm:blur-[10px] saturate-125"
            )}
          />
          {/* Balanced cinematic vignette gradients (preserving backdrop visibility) */}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/45 to-transparent transition-colors duration-250" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base,#000000)]/80 via-[var(--bg-base,#000000)]/20 to-transparent transition-colors duration-250" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent transition-colors duration-250" />
        </div>

        {/* Fluid Full-Width Details Content Container */}
        <div className="w-full px-[clamp(1.5rem,5vw,5rem)] -mt-44 sm:-mt-52 relative z-10 pb-24 space-y-10">
          {/* Top Hero Row */}
          <div className="flex flex-col md:flex-row items-start gap-8 lg:gap-12">
            {/* Vertical Crisp Poster */}
            <div className="w-56 sm:w-64 lg:w-76 aspect-[2/3] rounded-2xl overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.95)] border border-white/15 flex-shrink-0 bg-zinc-900">
              <img
                src={details?.poster || media.poster}
                alt={details?.title || media.title}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Title, Badges, Actions, Description */}
            <div className="flex-1 space-y-5 min-w-0">
              {/* Badges Row */}
              <div className="flex flex-wrap items-center gap-2.5">
                {(details?.imdb_rating || media.rating) && (
                  <span className="flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                    IMDb {details?.imdb_rating || media.rating}
                  </span>
                )}
                {details?.kp_rating && (
                  <span className="flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                    Кинопоиск {details.kp_rating}
                  </span>
                )}
                <span className="px-3 py-1 rounded-xl text-xs font-bold uppercase bg-rose-600/90 text-white border border-rose-400/30">
                  {isSeries ? "Серіал" : "Фільм"}
                </span>
                {details && !hasAvailableStream && (
                  <span className="flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    В очікуванні
                  </span>
                )}
                {media.misc_info && (
                  <span className="text-xs text-zinc-300 font-medium px-1">
                    {media.misc_info}
                  </span>
                )}
              </div>

              {/* Main Titles */}
              <div className="space-y-1">
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
                  {details?.title || media.title}
                </h1>
                {details?.orig_title && (
                  <p className="text-base sm:text-lg font-medium text-zinc-400">
                    {details.orig_title}
                  </p>
                )}
              </div>

              {/* Actions & Details Area (Instant Skeleton Shimmer or Real Actions) */}
              {loading && !details ? (
                <div className="space-y-5 pt-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-gradient-to-r from-rose-700/70 via-rose-600/70 to-rose-500/70 text-white font-bold text-sm shadow-xl shadow-rose-950/40 select-none">
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Завантаження плеєра...</span>
                    </div>

                    <button
                      onClick={() => {
                        const bookmarkItem: Bookmark = {
                          media_id: media.id,
                          media_url: media.url,
                          title: media.title,
                          poster_url: media.poster,
                          media_type: isSeries ? "series" : "movie",
                          year_info: media.misc_info || null,
                          rating: media.rating || null,
                          category: getBookmarkCategory(),
                          added_at: Math.floor(Date.now() / 1000),
                        };
                        onToggleBookmark(bookmarkItem);
                      }}
                      className={cn(
                        "flex items-center gap-2 px-5 py-3.5 rounded-2xl font-semibold text-sm border transition-all cursor-pointer active:scale-95",
                        isBookmarked
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30"
                          : "bg-white/10 hover:bg-white/20 text-white border-white/15"
                      )}
                    >
                      <BookmarkIcon
                        className={cn("w-4 h-4", isBookmarked && "fill-amber-400")}
                      />
                      <span>{isBookmarked ? "У закладках" : "У закладки"}</span>
                    </button>
                  </div>

                  {/* Shimmer Description Lines */}
                  <div className="space-y-2.5 pt-1 max-w-3xl animate-pulse">
                    <div className="h-4 bg-white/10 rounded-lg w-full" />
                    <div className="h-4 bg-white/10 rounded-lg w-11/12" />
                    <div className="h-4 bg-white/10 rounded-lg w-3/4" />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
                    <span>Отримання інформації про озвучення та якість...</span>
                  </div>
                </div>
              ) : fetchError ? (
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-center justify-between gap-4 mt-2">
                  <span>{fetchError}</span>
                </div>
              ) : details ? (
                <>
                  {/* Primary Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    {hasAvailableStream ? (
                      <button
                        onClick={() => handleStartPlayback()}
                        className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-rose-700 via-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-400 text-white font-bold text-sm shadow-xl shadow-rose-950/60 active:scale-95 transition-all cursor-pointer shrink-0"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>
                          {savedProgress && savedProgress.position_sec > 10
                            ? `Продовжити (${Math.floor(savedProgress.position_sec / 60)} хв)`
                            : isSeries
                            ? `Дивитися S${selectedSeason}E${selectedEpisode}`
                            : "Дивитися"}
                        </span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 px-5 py-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-sm shadow-md select-none cursor-default shrink-0">
                        <Clock className="w-4 h-4 text-amber-400" />
                        <span>В очікуванні</span>
                      </div>
                    )}

                    {/* Structured Voiceover Selector Dropdown Next to Watch Button */}
                    {details.translators && details.translators.length > 0 && (
                      <div ref={dropdownRef} className="relative shrink-0">
                        <button
                          onClick={() => setIsTranslatorDropdownOpen(!isTranslatorDropdownOpen)}
                          className="flex items-center gap-2 px-4 py-3.5 rounded-2xl bg-zinc-900 border border-white/15 hover:border-rose-500/60 hover:bg-zinc-850 text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-lg active:scale-95"
                          title="Обрати студію озвучення"
                        >
                          <Mic className="w-4 h-4 text-rose-400 shrink-0" />
                          {selectedTranslator?.language?.toLowerCase().includes("украин") ||
                          selectedTranslator?.language?.toLowerCase().includes("україн") ? (
                            <span className="text-sm shrink-0">🇺🇦</span>
                          ) : null}
                          <span className="truncate max-w-[130px] sm:max-w-[170px]">
                            {selectedTranslator?.name || "Озвучення"}
                          </span>
                          {selectedTranslator?.is_premium && (
                            <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0">
                              <Crown className="w-3 h-3 text-amber-400" />
                            </span>
                          )}
                          <ChevronDown
                            className={cn(
                              "w-3.5 h-3.5 text-zinc-400 transition-transform shrink-0",
                              isTranslatorDropdownOpen && "rotate-180"
                            )}
                          />
                          <span className="text-[11px] text-zinc-500 font-mono">
                            {details.translators.length}
                          </span>
                        </button>

                        {/* Searchable Dropdown Popover */}
                        {isTranslatorDropdownOpen && (
                          <div className="absolute top-14 left-0 w-80 sm:w-96 max-h-96 overflow-hidden bg-zinc-900 border border-white/20 rounded-2xl shadow-2xl p-3 z-50 flex flex-col space-y-2 ring-1 ring-black/60">
                            {/* Search input inside dropdown */}
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                              <input
                                autoFocus
                                type="text"
                                value={translatorSearch}
                                onChange={(e) => setTranslatorSearch(e.target.value)}
                                placeholder="Пошук озвучення..."
                                className="w-full bg-zinc-800 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                              />
                            </div>

                            {/* Tabs */}
                            <div className="flex gap-1 border-b border-white/10 pb-1.5">
                              <button
                                onClick={() => setTranslatorFilterTab("all")}
                                className={cn(
                                  "px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer",
                                  translatorFilterTab === "all"
                                    ? "bg-rose-600 text-white"
                                    : "text-zinc-400 hover:text-white"
                                )}
                              >
                                Всі ({details.translators.length})
                              </button>
                              {ukrTranslators.length > 0 && (
                                <button
                                  onClick={() => setTranslatorFilterTab("ukr")}
                                  className={cn(
                                    "px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer",
                                    translatorFilterTab === "ukr"
                                      ? "bg-rose-600 text-white"
                                      : "text-zinc-400 hover:text-white"
                                  )}
                                >
                                  <span>🇺🇦</span>
                                  <span>Українські ({ukrTranslators.length})</span>
                                </button>
                              )}
                            </div>

                            {/* Studios List */}
                            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                              {filteredTranslators.map((t) => {
                                const isSelected = selectedTranslator?.id === t.id;
                                const isUkr =
                                  t.language?.toLowerCase().includes("украин") ||
                                  t.language?.toLowerCase().includes("україн");

                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => handleTranslatorSelect(t)}
                                    className={cn(
                                      "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer",
                                      isSelected
                                        ? "bg-rose-600 text-white"
                                        : "hover:bg-white/10 text-zinc-200"
                                    )}
                                  >
                                    <div className="flex items-center gap-2 truncate">
                                      {isUkr && <span>🇺🇦</span>}
                                      <span className="truncate">{t.name}</span>
                                      {t.is_premium && (
                                        <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5 shrink-0">
                                          <Crown className="w-2.5 h-2.5 text-amber-400" />
                                          PREMIUM
                                        </span>
                                      )}
                                    </div>
                                    {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => {
                        const bookmarkItem: Bookmark = {
                          media_id: details.id,
                          media_url: details.url,
                          title: details.title,
                          poster_url: details.poster,
                          media_type: isSeries ? "series" : "movie",
                          year_info: details.year ? [details.year, details.countries?.[0]].filter(Boolean).join(", ") : (media?.misc_info || null),
                          rating: details.imdb_rating || details.kp_rating || null,
                          category: getBookmarkCategory(),
                          added_at: Math.floor(Date.now() / 1000),
                        };
                        onToggleBookmark(bookmarkItem);
                      }}
                      className={cn(
                        "flex items-center gap-2 px-5 py-3.5 rounded-2xl font-semibold text-xs sm:text-sm border transition-all cursor-pointer active:scale-95 shrink-0",
                        isBookmarked
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30"
                          : !hasAvailableStream
                          ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-500 shadow-xl shadow-rose-950/60 font-bold"
                          : "bg-white/10 hover:bg-white/20 text-white border-white/15"
                      )}
                    >
                      <BookmarkIcon
                        className={cn("w-4 h-4", isBookmarked && "fill-amber-400")}
                      />
                      <span>{isBookmarked ? "У закладках" : "У закладки"}</span>
                    </button>

                    {hasAvailableStream && (
                      <button
                        onClick={handleOpenDownloadModal}
                        className="flex items-center gap-2 px-5 py-3.5 rounded-2xl font-semibold text-xs sm:text-sm border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-all cursor-pointer active:scale-95 shadow-lg shadow-rose-950/30 shrink-0"
                        title="Завантажити для перегляду офлайн"
                      >
                        <Download className="w-4 h-4 text-rose-400" />
                        <span>Завантажити</span>
                      </button>
                    )}
                  </div>

                  {/* Premium Translator Warning Notice */}
                  {selectedTranslator?.is_premium && (
                    <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs">
                      <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-300">
                          Озвучення доступне лише для передплатників HDRezka Premium.
                        </span>
                        <p className="text-[11px] text-amber-200/80 mt-0.5 leading-relaxed">
                          Без підписки замість фільму транслюється 1-хвилинне промо-відео сайту із QR-кодом.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Informational banner if title has no streams yet ("В очікуванні") */}
                  {!hasAvailableStream && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs sm:text-sm max-w-2xl">
                      <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-semibold text-amber-300">
                          Фільм ще не вийшов у прокат або очікує надходження
                        </p>
                        <p className="text-zinc-400 text-xs leading-relaxed">
                          Відеопотік або озвучення поки відсутні на HDRezka. Ви можете додати тайтл у закладки, щоб не пропустити появу плеєра на сайті!
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  {details.description && (
                    <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-4xl pt-1">
                      {details.description}
                    </p>
                  )}
                </>
              ) : null}
              </div>
            </div>

            {/* Below Hero Row: Seasons & Episodes (ALWAYS show seasons row for series) */}
            {details && isSeries && details.seasons.length >= 1 && (
              <div className="space-y-6 pt-6 border-t border-white/10">
                {/* Seasons Row */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">
                      Сезони
                    </h3>
                    {maxKnownSeasons > 1 && details.seasons.length < maxKnownSeasons && (
                      <span className="text-xs text-amber-400/90 font-medium flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-xl">
                        <Info className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                          У цій озвучці доступно {details.seasons.length} з {maxKnownSeasons} сезонів. Оберіть іншу озвучку вище для перегляду решти.
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar">
                    {details.seasons.map((s) => {
                      const seasonNum = parseInt(s.id, 10);
                      const isSelected = selectedSeason === seasonNum;
                      return (
                        <button
                          key={s.id}
                          onClick={() => {
                            setSelectedSeason(seasonNum);
                            setSelectedEpisode(1);
                          }}
                          className={cn(
                            "px-5 py-2.5 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap cursor-pointer",
                            isSelected
                              ? "bg-white text-zinc-950 shadow-md font-extrabold"
                              : "bg-zinc-900 text-zinc-400 hover:text-white border border-white/10"
                          )}
                        >
                          {s.title}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Episodes Grid with Fluid CSS Grid */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">
                      Серії ({currentSeasonEpisodes.length})
                    </h3>
                    {loadingEpisodes && (
                      <div className="flex items-center gap-1.5 text-xs text-rose-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Оновлення...</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5">
                    {currentSeasonEpisodes.map((ep) => {
                      const epNum = parseInt(ep.episode_id, 10);
                      const epSeasonNum = parseInt(ep.season_id, 10);
                      const isSelected =
                        selectedSeason === epSeasonNum &&
                        selectedEpisode === epNum;

                      const isSaved =
                        savedProgress &&
                        savedProgress.season === epSeasonNum &&
                        savedProgress.episode === epNum;

                      const epProg = episodeProgressList.find(
                        (p) => p.season === epSeasonNum && p.episode === epNum
                      );
                      const progressPct =
                        epProg && epProg.duration_sec > 0
                          ? Math.min(100, Math.round((epProg.position_sec / epProg.duration_sec) * 100))
                          : 0;
                      const isWatched = progressPct >= 90;

                      return (
                        <button
                          key={`${ep.season_id}-${ep.episode_id}`}
                          onClick={() => {
                            setSelectedEpisode(epNum);
                            handleStartPlayback(epSeasonNum, epNum);
                          }}
                          data-episode-watched={isWatched ? "true" : undefined}
                          data-episode-progress={progressPct > 0 ? progressPct : undefined}
                          className={cn(
                            "relative flex flex-col items-center justify-center p-3.5 rounded-xl border text-xs font-medium transition-all cursor-pointer group overflow-hidden",
                            isSelected
                              ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/60"
                              : isWatched
                              ? "bg-emerald-950/15 border-emerald-500/25 hover:bg-emerald-900/20 text-zinc-300"
                              : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border-white/10"
                          )}
                        >
                          {isWatched && (
                            <div
                              title="Переглянуто"
                              className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shadow-sm"
                            >
                              <Check className="w-3 h-3" />
                            </div>
                          )}

                          {!isWatched && isSaved && (
                            <div
                              title="Переглядається зараз"
                              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                            />
                          )}

                          <span className="font-bold text-base">
                            {ep.episode_id}
                          </span>
                          <span
                            className={cn(
                              "text-[11px] truncate max-w-full transition-colors",
                              isSelected
                                ? "text-white/95 font-medium"
                                : "text-zinc-400 group-hover:text-zinc-200"
                            )}
                          >
                            серія
                          </span>

                          {progressPct > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 overflow-hidden rounded-b-xl">
                              <div
                                className={cn(
                                  "h-full transition-all",
                                  isWatched ? "bg-emerald-500" : "bg-rose-500"
                                )}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Information Table (Metadata) */}
            {details && details.info_table && details.info_table.length > 0 && (
              <div className="space-y-3 pt-6 border-t border-white/10">
                <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">
                  Інформація про фільм
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs">
                  {details.info_table.map(([key, val], idx) => (
                    <div
                      key={idx}
                      className="flex py-1.5 border-b border-white/5"
                    >
                      <span className="w-1/3 text-zinc-400 font-medium">
                        {key.replace(/:+$/, "")}:
                      </span>
                      <span className="w-2/3 text-zinc-200">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Offline Download Dialog (Android TV Glassmorphic UI) */}
        {isDownloadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200">
            <div className="relative w-full max-w-lg bg-zinc-900/95 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-5 text-white backdrop-blur-2xl max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500/20 to-rose-600/30 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-md shadow-rose-950/40">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-base sm:text-lg tracking-tight">Завантажити офлайн</h3>
                    <p className="text-xs text-zinc-400 truncate max-w-[280px] sm:max-w-xs">{details?.title}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDownloadModalOpen(false)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                  title="Закрити"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Voiceover Selection Section */}
              {details && details.translators && details.translators.length > 0 && (
                <div className="space-y-2" ref={downloadTranslatorDropdownRef}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-rose-400" />
                      <span>Озвучення:</span>
                    </span>
                    {downloadTranslator && (downloadTranslator.language?.toLowerCase().includes("украин") || downloadTranslator.language?.toLowerCase().includes("україн") || downloadTranslator.name.toLowerCase().includes("украин") || downloadTranslator.name.toLowerCase().includes("україн")) && (
                      <span className="text-[10px] font-bold text-amber-300 bg-amber-400/15 border border-amber-400/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span>🇺🇦</span>
                        <span>Українська</span>
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => setIsDownloadTranslatorDropdownOpen(!isDownloadTranslatorDropdownOpen)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-zinc-950/80 hover:bg-zinc-950 border border-white/10 text-xs font-semibold text-zinc-100 transition-all cursor-pointer group hover:border-white/20"
                    >
                      <div className="flex items-center gap-2 truncate">
                        {(downloadTranslator?.language?.toLowerCase().includes("украин") || downloadTranslator?.language?.toLowerCase().includes("україн") || downloadTranslator?.name.toLowerCase().includes("украин") || downloadTranslator?.name.toLowerCase().includes("україн")) ? (
                          <span className="text-sm">🇺🇦</span>
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-rose-500" />
                        )}
                        <span className="truncate">{downloadTranslator?.name || selectedTranslator?.name || "Оригінал / За замовчуванням"}</span>
                      </div>
                      <ChevronDown
                        className={cn(
                          "w-4 h-4 text-zinc-400 group-hover:text-white transition-transform duration-200",
                          isDownloadTranslatorDropdownOpen && "rotate-180"
                        )}
                      />
                    </button>

                    {isDownloadTranslatorDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1.5 max-h-52 overflow-y-auto bg-zinc-950/98 border border-white/15 rounded-2xl shadow-2xl p-1.5 z-50 space-y-1 backdrop-blur-2xl">
                        {details.translators.map((t) => {
                          const isUkr = t.language?.toLowerCase().includes("украин") || t.language?.toLowerCase().includes("україн") || t.name.toLowerCase().includes("украин") || t.name.toLowerCase().includes("україн");
                          const isSelected = (downloadTranslator?.id || selectedTranslator?.id || "") === t.id;
                          return (
                            <button
                              key={t.id}
                              onClick={() => handleDownloadTranslatorChange(t)}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left",
                                isSelected
                                  ? "bg-rose-600 text-white font-bold shadow-md shadow-rose-950/50"
                                  : "text-zinc-300 hover:bg-white/10 hover:text-white"
                              )}
                            >
                              <div className="flex items-center gap-2 truncate">
                                {isUkr ? <span>🇺🇦</span> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />}
                                <span className="truncate">{t.name}</span>
                              </div>
                              {isSelected && <Check className="w-4 h-4 text-white flex-shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Series Scope Option */}
              {isSeries && details && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-rose-400" />
                      <span>Що завантажити:</span>
                    </span>
                    {downloadMode === "custom" && (
                      <span className="text-[11px] font-bold text-rose-300 bg-rose-500/15 border border-rose-500/30 px-2.5 py-0.5 rounded-full">
                        Вибрано: {selectedCustomEpisodes.size} серій
                      </span>
                    )}
                  </div>

                  {/* 4-option Segmented Switch */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-zinc-950/80 rounded-2xl border border-white/5 text-xs font-semibold">
                    <button
                      onClick={() => setDownloadMode("single")}
                      className={cn(
                        "px-2 py-2 rounded-xl transition-all cursor-pointer text-center truncate",
                        downloadMode === "single"
                          ? "bg-rose-600 text-white shadow-md shadow-rose-950/50"
                          : "text-zinc-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      1 серія
                    </button>
                    <button
                      onClick={() => setDownloadMode("season")}
                      className={cn(
                        "px-2 py-2 rounded-xl transition-all cursor-pointer text-center truncate",
                        downloadMode === "season"
                          ? "bg-rose-600 text-white shadow-md shadow-rose-950/50"
                          : "text-zinc-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {downloadTargetSeason} сезон
                    </button>
                    <button
                      onClick={() => setDownloadMode("all_seasons")}
                      className={cn(
                        "px-2 py-2 rounded-xl transition-all cursor-pointer text-center truncate",
                        downloadMode === "all_seasons"
                          ? "bg-rose-600 text-white shadow-md shadow-rose-950/50"
                          : "text-zinc-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      Всі сезони ({details.seasons.length})
                    </button>
                    <button
                      onClick={() => setDownloadMode("custom")}
                      className={cn(
                        "px-2 py-2 rounded-xl transition-all cursor-pointer text-center truncate",
                        downloadMode === "custom"
                          ? "bg-rose-600 text-white shadow-md shadow-rose-950/50"
                          : "text-zinc-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      Вибіркові серії
                    </button>
                  </div>

                  {/* If 'season' mode is selected: show horizontal pills to pick season! */}
                  {downloadMode === "season" && details.seasons.length > 1 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] text-zinc-400 flex items-center justify-between">
                        <span>Виберіть сезон для завантаження:</span>
                        <span className="text-rose-400 font-mono font-semibold">
                          {details.episodes.filter(ep => Number(ep.season_id) === Number(downloadTargetSeason)).length} серій
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                        {details.seasons.map((s) => {
                          const sNum = Number(s.id);
                          const isSelected = downloadTargetSeason === sNum;
                          const count = details.episodes.filter((ep) => Number(ep.season_id) === sNum).length;
                          return (
                            <button
                              key={s.id}
                              onClick={() => setDownloadTargetSeason(sNum)}
                              className={cn(
                                "px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer",
                                isSelected
                                  ? "bg-rose-600/30 border-rose-500 text-rose-300 font-bold shadow-sm"
                                  : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                              )}
                            >
                              Сезон {s.id} {count > 0 ? `(${count})` : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* If 'all_seasons' is selected: show summary info */}
                  {downloadMode === "all_seasons" && (
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                      <span className="text-base">📦</span>
                      <span>
                        Буде додано до черги <strong>{details.episodes.length} серій</strong> із усіх <strong>{details.seasons.length} сезонів</strong>.
                      </span>
                    </div>
                  )}

                  {/* If 'custom' mode is selected: show season tabs + episode selection grid! */}
                  {downloadMode === "custom" && (
                    <div className="space-y-2.5 p-3.5 rounded-2xl bg-zinc-950/70 border border-white/10">
                      {/* Season Tabs Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                          {details.seasons.map((s) => {
                            const sNum = Number(s.id);
                            const isTabActive = customSeasonTab === sNum;
                            const countInSeason = details.episodes.filter(
                              (ep) => Number(ep.season_id) === sNum && selectedCustomEpisodes.has(`${ep.season_id}_${ep.episode_id}`)
                            ).length;
                            return (
                              <button
                                key={s.id}
                                onClick={() => setCustomSeasonTab(sNum)}
                                className={cn(
                                  "px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5",
                                  isTabActive
                                    ? "bg-rose-600 text-white shadow-sm"
                                    : "bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white"
                                )}
                              >
                                <span>{s.id} сезон</span>
                                {countInSeason > 0 && (
                                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
                                    {countInSeason}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Quick select buttons for active season tab */}
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-zinc-400">
                          Серії {customSeasonTab} сезону:
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const seasonEps = details.episodes.filter(
                                (ep) => Number(ep.season_id) === customSeasonTab
                              );
                              setSelectedCustomEpisodes((prev) => {
                                const next = new Set(prev);
                                seasonEps.forEach((ep) => next.add(`${ep.season_id}_${ep.episode_id}`));
                                return next;
                              });
                            }}
                            className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                          >
                            + Весь {customSeasonTab} сезон
                          </button>
                          <span className="text-zinc-600">•</span>
                          <button
                            type="button"
                            onClick={() => {
                              const seasonEps = details.episodes.filter(
                                (ep) => Number(ep.season_id) === customSeasonTab
                              );
                              setSelectedCustomEpisodes((prev) => {
                                const next = new Set(prev);
                                seasonEps.forEach((ep) => next.delete(`${ep.season_id}_${ep.episode_id}`));
                                return next;
                              });
                            }}
                            className="text-zinc-400 hover:text-zinc-300 cursor-pointer"
                          >
                            Зняти
                          </button>
                        </div>
                      </div>

                      {/* Episode Grid for active season tab */}
                      <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 max-h-40 overflow-y-auto pr-1 no-scrollbar">
                        {details.episodes
                          .filter((ep) => Number(ep.season_id) === customSeasonTab)
                          .map((ep) => {
                            const key = `${ep.season_id}_${ep.episode_id}`;
                            const isSelected = selectedCustomEpisodes.has(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  setSelectedCustomEpisodes((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(key)) {
                                      next.delete(key);
                                    } else {
                                      next.add(key);
                                    }
                                    return next;
                                  });
                                }}
                                className={cn(
                                  "py-1.5 px-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center justify-center gap-1 select-none",
                                  isSelected
                                    ? "bg-rose-600 border-rose-500 text-white shadow-md shadow-rose-950/50 scale-[1.02]"
                                    : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
                                )}
                              >
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                                <span>{ep.episode_id}</span>
                              </button>
                            );
                          })}
                      </div>

                      {/* Global selection helpers */}
                      <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-zinc-400">
                        <button
                          type="button"
                          onClick={() => {
                            const all = new Set<string>();
                            details.episodes.forEach((ep) => all.add(`${ep.season_id}_${ep.episode_id}`));
                            setSelectedCustomEpisodes(all);
                          }}
                          className="hover:text-white cursor-pointer font-medium"
                        >
                          Вибрати всі серії ({details.episodes.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomEpisodes(new Set())}
                          className="text-zinc-500 hover:text-zinc-400 cursor-pointer"
                        >
                          Очистити вибір
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Quality Selector */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Якість відео:</span>
                {loadingQualities ? (
                  <div className="flex items-center gap-2 py-3 px-3 rounded-2xl bg-white/5 border border-white/5 text-xs text-zinc-400">
                    <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                    <span>Отримання доступних якостей...</span>
                  </div>
                ) : downloadQualities.length === 0 ? (
                  <div className="py-2 text-xs text-zinc-400">
                    За замовчуванням: 1080p / 720p MP4
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {downloadQualities.map((q) => {
                      const isSelected = selectedDownloadQuality === q.label;
                      const isPrem = isPremiumQuality(q.label);
                      return (
                        <button
                          key={q.label}
                          onClick={() => setSelectedDownloadQuality(q.label)}
                          className={cn(
                            "relative px-3 py-2.5 rounded-xl text-xs font-medium border text-center transition-all cursor-pointer flex items-center justify-center gap-1.5",
                            isSelected
                              ? "bg-rose-600 border-rose-500 text-white font-bold shadow-lg shadow-rose-950/50 scale-[1.02]"
                              : "bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <span>{q.label}</span>
                          {isPrem && (
                            <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400/25 flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Dynamic Summary Note */}
              {details && (
                <div className="text-[11px] text-zinc-400 flex items-center justify-between px-1 pt-1 border-t border-white/5">
                  <span>Разом до завантаження:</span>
                  <span className="font-bold text-white font-mono">
                    {!isSeries || downloadMode === "single"
                      ? `1 файл • ${selectedDownloadQuality}`
                      : downloadMode === "season"
                      ? `${details.episodes.filter(ep => Number(ep.season_id) === Number(downloadTargetSeason)).length} серій • ${selectedDownloadQuality}`
                      : downloadMode === "all_seasons"
                      ? `${details.episodes.length} серій • всі сезони • ${selectedDownloadQuality}`
                      : `${selectedCustomEpisodes.size} вибраних серій • ${selectedDownloadQuality}`}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setIsDownloadModalOpen(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold border border-white/10 transition-colors cursor-pointer"
                >
                  Скасувати
                </button>
                <button
                  onClick={handleStartDownload}
                  disabled={isSeries && downloadMode === "custom" && selectedCustomEpisodes.size === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-950/50 cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    Почати {isSeries && downloadMode === "all_seasons" ? `(${details?.episodes.length})` : isSeries && downloadMode === "season" ? `(${details?.episodes.filter(ep => Number(ep.season_id) === Number(downloadTargetSeason)).length})` : isSeries && downloadMode === "custom" ? `(${selectedCustomEpisodes.size})` : ""}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Floating Download Notification Toast (Clickable to jump to Downloads) */}
        {downloadNotification && (
          <div
            onClick={() => {
              setDownloadNotification(null);
              handleClose();
              openDownloadsTab();
            }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-zinc-900/95 backdrop-blur-md border border-rose-500/50 text-white text-xs font-semibold shadow-2xl shadow-rose-950/80 cursor-pointer hover:bg-zinc-800/95 hover:border-rose-400 transition-all group active:scale-95 animate-in fade-in slide-in-from-bottom-3"
            title="Перейти до списку завантажень"
          >
            <Download className="w-4 h-4 text-rose-400 animate-bounce group-hover:scale-110 transition-transform shrink-0" />
            <div className="flex flex-col">
              <span className="text-zinc-200">{downloadNotification}</span>
              <span className="text-[10px] text-rose-400 font-bold group-hover:underline flex items-center gap-1">
                Відкрити список завантажень →
              </span>
            </div>
          </div>
        )}
      </div>
  );
};
