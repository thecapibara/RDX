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
} from "lucide-react";
import type { Bookmark, MediaCard, MediaDetails, WatchProgress, Translator } from "../types";
import { api } from "../services/api";
import { cn } from "../lib/utils";

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
  const [selectedTranslator, setSelectedTranslator] = useState<Translator | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  // Dropdown states for structured voiceover selector
  const [isTranslatorDropdownOpen, setIsTranslatorDropdownOpen] = useState(false);
  const [translatorFilterTab, setTranslatorFilterTab] = useState<"all" | "ukr">("all");
  const [translatorSearch, setTranslatorSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Keyboard shortcut: Escape to close modal (or close dropdown if open)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (isTranslatorDropdownOpen) {
          setIsTranslatorDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isTranslatorDropdownOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !media) {
      setDetails(null);
      setSavedProgress(null);
      setSelectedTranslator(null);
      setIsTranslatorDropdownOpen(false);
      setFetchError(null);
      return;
    }

    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const [det, progress] = await Promise.all([
          api.getMediaDetails(media.url),
          api.getWatchProgress(media.id).catch(() => null),
        ]);

        if (!isMounted) return;

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
      (ep) => ep.season_id === String(selectedSeason)
    ) || [];

  const handleStartPlayback = (season?: number, ep?: number) => {
    if (!details) return;

    const playSeason = season ?? selectedSeason;
    const playEp = ep ?? selectedEpisode;

    const isCurrentProgress =
      savedProgress &&
      (!isSeries ||
        (savedProgress.season === playSeason &&
          savedProgress.episode === playEp));

    const initialPos = isCurrentProgress ? savedProgress.position_sec : 0;

    onPlay(
      details,
      selectedTranslator?.id,
      isSeries ? playSeason : undefined,
      isSeries ? playEp : undefined,
      initialPos
    );
  };

  // Ukrainian translators list
  const ukrTranslators =
    details?.translators.filter(
      (t) =>
        t.language?.toLowerCase().includes("украин") ||
        t.language?.toLowerCase().includes("україн")
    ) || [];

  // Filtered translators for dropdown
  const filteredTranslators =
    details?.translators.filter((t) => {
      if (translatorFilterTab === "ukr") {
        const isUkr =
          t.language?.toLowerCase().includes("украин") ||
          t.language?.toLowerCase().includes("україн");
        if (!isUkr) return false;
      }
      if (translatorSearch.trim()) {
        return t.name.toLowerCase().includes(translatorSearch.toLowerCase());
      }
      return true;
    }) || [];

  return (
    <div className="fixed inset-0 z-50 bg-[#08090d] overflow-y-auto overflow-x-hidden select-none">
      {/* Top Floating Back Button */}
      <button
        onClick={onClose}
        className="fixed top-6 left-6 sm:left-10 lg:left-14 z-40 flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white border border-white/15 backdrop-blur-md transition-all shadow-2xl active:scale-95 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-xs font-semibold">Назад</span>
      </button>

      {/* Full Modal Layout (Rendered INSTANTLY with ambient backdrop and poster) */}
      <div className="relative w-full">
        {/* Full-Bleed Atmospheric Backdrop with Ambient Soft-Focus Blur */}
        <div className="relative w-full h-[55vh] min-h-[420px] max-h-[620px] overflow-hidden pointer-events-none transform-gpu [isolation:isolate]">
          <img
            src={details?.high_res_poster || details?.poster || media.poster}
            alt={details?.title || media.title}
            decoding="async"
            className="w-full h-full object-cover object-[center_20%] sm:object-[75%_20%] opacity-35 sm:opacity-40 scale-110 blur-[12px] sm:blur-[18px] saturate-125 transform-gpu"
          />
          {/* Smooth seamless multi-stop gradients for cinematic vignette */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#08090d] via-[#08090d]/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-[#08090d]" />
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
                    <div className="flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-gradient-to-r from-red-600/70 via-rose-600/70 to-rose-500/70 text-white font-bold text-sm shadow-xl shadow-rose-950/40 select-none">
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
                          category: "favorites",
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
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      onClick={() => handleStartPlayback()}
                      className="flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-rose-500 hover:from-red-500 hover:to-rose-400 text-white font-bold text-sm shadow-xl shadow-rose-950/60 active:scale-95 transition-all cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>
                        {savedProgress && savedProgress.position_sec > 10
                          ? `Продовжити (${Math.floor(savedProgress.position_sec / 60)} хв)`
                          : isSeries
                          ? `Дивитися S${selectedSeason}E${selectedEpisode}`
                          : "Дивитися фільм"}
                      </span>
                    </button>

                    <button
                      onClick={() => {
                        const bookmarkItem: Bookmark = {
                          media_id: details.id,
                          media_url: details.url,
                          title: details.title,
                          poster_url: details.poster,
                          media_type: isSeries ? "series" : "movie",
                          year_info: details.orig_title || null,
                          rating: details.imdb_rating || details.kp_rating || null,
                          category: "favorites",
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

                  {/* Description */}
                  {details.description && (
                    <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-4xl pt-1">
                      {details.description}
                    </p>
                  )}

                {/* Structured Voiceover Selector (No Wall of 28 Pills!) */}
                {details.translators && details.translators.length > 0 && (
                  <div className="space-y-3 pt-3 border-t border-white/10">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                        Озвучення:
                      </span>

                      {/* Main Dropdown Button */}
                      <div ref={dropdownRef} className="relative">
                        <button
                          onClick={() => setIsTranslatorDropdownOpen(!isTranslatorDropdownOpen)}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 border border-white/15 hover:border-rose-500/50 text-white text-xs font-semibold transition-all cursor-pointer shadow-lg"
                        >
                          {selectedTranslator?.language?.toLowerCase().includes("украин") ||
                          selectedTranslator?.language?.toLowerCase().includes("україн") ? (
                            <span className="text-sm">🇺🇦</span>
                          ) : null}
                          <span className="truncate max-w-[200px]">
                            {selectedTranslator?.name || "Оберіть озвучення"}
                          </span>
                          <ChevronDown
                            className={cn(
                              "w-3.5 h-3.5 text-zinc-400 transition-transform",
                              isTranslatorDropdownOpen && "rotate-180"
                            )}
                          />
                          <span className="text-[11px] text-zinc-500 font-mono ml-0.5">
                            ({details.translators.length})
                          </span>
                        </button>

                        {/* Searchable Dropdown Popover */}
                        {isTranslatorDropdownOpen && (
                          <div className="absolute top-12 left-0 w-80 sm:w-96 max-h-96 overflow-hidden bg-zinc-900 border border-white/15 rounded-2xl shadow-2xl p-3 z-50 flex flex-col space-y-2">
                            {/* Search input inside dropdown */}
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                              <input
                                autoFocus
                                type="text"
                                value={translatorSearch}
                                onChange={(e) => setTranslatorSearch(e.target.value)}
                                placeholder="Пошук студії озвучення..."
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
                                    </div>
                                    {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Quick-Access Chips for Top Ukrainian Studios (At most 3-4 chips) */}
                      {ukrTranslators.slice(0, 4).map((t) => {
                        const isSelected = selectedTranslator?.id === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => handleTranslatorSelect(t)}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer",
                              isSelected
                                ? "bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-950/60"
                                : "bg-white/5 hover:bg-white/10 text-zinc-300 border-white/10"
                            )}
                          >
                            <span>🇺🇦</span>
                            <span className="truncate max-w-[130px]">{t.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                    {details.seasons.length === 1 && (
                      <span className="text-xs text-amber-400/90 font-medium flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-xl">
                        <Info className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                          У цій озвучці доступний лише {details.seasons[0].title}. Оберіть іншу озвучку вище для перегляду інших сезонів.
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
                      const isSelected =
                        selectedSeason === parseInt(ep.season_id, 10) &&
                        selectedEpisode === epNum;

                      const isSaved =
                        savedProgress &&
                        savedProgress.season === parseInt(ep.season_id, 10) &&
                        savedProgress.episode === epNum;

                      return (
                        <button
                          key={`${ep.season_id}-${ep.episode_id}`}
                          onClick={() => {
                            setSelectedEpisode(epNum);
                            handleStartPlayback(parseInt(ep.season_id, 10), epNum);
                          }}
                          className={cn(
                            "relative flex flex-col items-center justify-center p-3.5 rounded-xl border text-xs font-medium transition-all cursor-pointer group",
                            isSelected
                              ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/60"
                              : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border-white/10"
                          )}
                        >
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
                          {isSaved && (
                            <div
                              title="Переглядається зараз"
                              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                            />
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
      </div>
  );
};
