import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import type {
  AppSettings,
  Bookmark,
  MediaCard as MediaCardType,
  MediaDetails,
  MirrorStatus,
  WatchProgress,
  DownloadItem,
  StreamData,
  Translator,
} from "./types";
import { api } from "./services/api";
import { TopBar, type NavTab } from "./components/TopBar";
import { HeroBanner } from "./components/HeroBanner";
import { Swimlane } from "./components/Swimlane";
import { ContinueWatchingSwimlane } from "./components/ContinueWatchingSwimlane";
import { MediaCard } from "./components/MediaCard";
import { MediaDetailsModal } from "./components/MediaDetailsModal";
import { VideoPlayer, type PlayerMode } from "./components/VideoPlayer";
import { MirrorModal } from "./components/MirrorModal";
import { SearchModal } from "./components/SearchModal";
import { UpdateModal } from "./components/UpdateModal";
import { BookmarksView } from "./components/BookmarksView";
import { DownloadsView } from "./components/DownloadsView";
import { CategoryFilterBar } from "./components/CategoryFilterBar";
import { playButtonClickSound } from "./services/sound";
import { convertFileSrc } from "@tauri-apps/api/core";
import { downloadsStore, OPEN_DOWNLOADS_EVENT } from "./services/downloadsStore";
import { checkForUpdates, type UpdateInfo } from "./services/updater";

export default function App() {
  // Navigation & Settings State
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus | null>(null);

  // Catalog State
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [homeItems, setHomeItems] = useState<MediaCardType[]>([]);
  const [watchingHeroItems, setWatchingHeroItems] = useState<MediaCardType[]>([]);
  const [categoryItems, setCategoryItems] = useState<MediaCardType[]>([]);
  const [categoryPage, setCategoryPage] = useState<number>(1);
  const [activeSort, setActiveSort] = useState<string>("last");
  const [activeGenre, setActiveGenre] = useState<string | null>(null);

  // Modals State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMirrorModalOpen, setIsMirrorModalOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [selectedMediaForDetails, setSelectedMediaForDetails] = useState<MediaCardType | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Player State
  const [activePlayerDetails, setActivePlayerDetails] = useState<MediaDetails | null>(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode>("full");
  const [activeTranslatorId, setActiveTranslatorId] = useState<string | undefined>();
  const [activeSeason, setActiveSeason] = useState<number | undefined>();
  const [activeEpisode, setActiveEpisode] = useState<number | undefined>();
  const [initialPositionSec, setInitialPositionSec] = useState<number>(0);

  // Bookmarks check state for current media
  const [isCurrentBookmarked, setIsCurrentBookmarked] = useState(false);
  const [bookmarksRefreshKey, setBookmarksRefreshKey] = useState(0);

  // Active Downloads Count State
  const [activeDownloadsCount, setActiveDownloadsCount] = useState(0);

  // Listen to download progress & track active downloads count
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const checkActiveDownloads = async () => {
      try {
        const items = await api.getDownloads();
        downloadsStore.updateFromItems(items);
        const active = items.filter(
          (i) => i.status === "downloading" || i.status === "queued"
        ).length;
        setActiveDownloadsCount(active);
      } catch {}
    };

    checkActiveDownloads();

    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen("download://progress", () => {
          checkActiveDownloads();
        }).then((u) => {
          unlisten = u;
        });
      });
    }

    const interval = setInterval(checkActiveDownloads, 4000);
    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, []);

  // Listen to global open downloads requests (e.g. from MediaCard download badges)
  useEffect(() => {
    const handleOpenDownloads = () => {
      setActiveTab("downloads");
    };
    window.addEventListener(OPEN_DOWNLOADS_EVENT, handleOpenDownloads);
    return () => window.removeEventListener(OPEN_DOWNLOADS_EVENT, handleOpenDownloads);
  }, []);

  // Global shortcut Ctrl+K / Cmd+K to open search anywhere, even when TopBar is hidden
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load Catalog based on current tab (with automatic Smart Mirror Failover if active mirror is down)
  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      if (activeTab === "home") {
        let [homeList, watchingList] = await Promise.all([
          api.getHomeCatalog().catch(() => [] as MediaCardType[]),
          api.getHomeCatalog("watching").catch(() => [] as MediaCardType[]),
        ]);
        if (homeList.length === 0) {
          // Active mirror failed or returned empty: auto-failover via Smart Rotator + DoH
          const rot = await api.smartSelectMirror(false).catch(() => null);
          if (rot?.selected_mirror) {
            setSettings((prev) =>
              prev ? { ...prev, active_mirror: rot.selected_mirror } : null
            );
            const bestStatus = rot.statuses.find((s) => s.mirror_url === rot.selected_mirror);
            if (bestStatus) setMirrorStatus(bestStatus);
          }
          const retryResults = await Promise.all([
            api.getHomeCatalog().catch(() => [] as MediaCardType[]),
            api.getHomeCatalog("watching").catch(() => [] as MediaCardType[]),
          ]);
          homeList = retryResults[0];
          watchingList = retryResults[1];
        }
        setHomeItems(homeList);
        setWatchingHeroItems(watchingList);
      } else if (activeTab !== "bookmarks" && activeTab !== "downloads") {
        const catList = await api.getCategoryCatalog(
          activeTab,
          activeGenre || undefined,
          activeSort !== "last" ? activeSort : undefined,
          categoryPage
        );
        setCategoryItems(catList);
      }
    } catch (err) {
      console.error("Failed to load catalog:", err);
      try {
        const downloads = await api.getDownloads();
        if (downloads && downloads.length > 0 && !navigator.onLine) {
          setActiveTab("downloads");
          return;
        }
      } catch {}
      setCatalogError(
        "Не вдалося з'єднатися з дзеркалом HDRezka. Будь ласка, перевірте з'єднання з мережею або перейдіть до розділу «Завантаження»."
      );
    } finally {
      setLoadingCatalog(false);
    }
  }, [activeTab, activeGenre, activeSort, categoryPage]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Load initial settings and mirror status (Happy Eyeballs Startup & Auto-Pilot)
  const initializeApp = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);

      const handleStatusCheck = async (status?: MirrorStatus) => {
        if (status) {
          setMirrorStatus(status);
        }

        let autopilot = true;
        try {
          autopilot = localStorage.getItem("rdx_mirror_autopilot") !== "false";
        } catch {
          autopilot = true;
        }

        const needsFailover =
          !status ||
          !status.online ||
          status.catalog_available === false ||
          status.stream_available === false ||
          status.latency_ms > 1800;

        if (autopilot && needsFailover) {
          try {
            const rot = await api.smartSelectMirror(false);
            if (rot?.selected_mirror) {
              setSettings((prev) =>
                prev ? { ...prev, active_mirror: rot.selected_mirror } : null
              );
              const bestStatus = rot.statuses?.find(
                (st) => st.mirror_url === rot.selected_mirror
              );
              if (bestStatus) {
                setMirrorStatus(bestStatus);
              }
              if (rot.switched) {
                loadCatalog();
              }
            }
          } catch (e) {
            console.warn("Auto-pilot smartSelectMirror failed:", e);
          }
        }
      };

      api.checkMirrorStatus(s.active_mirror)
        .then((st) => handleStatusCheck(st))
        .catch((err) => {
          console.warn("Failed checking active mirror status:", err);
          handleStatusCheck(undefined);
        });
    } catch (e) {
      console.warn("Failed to get initial settings:", e);
    }
  }, [loadCatalog]);

  useEffect(() => {
    initializeApp();
    const timer = setTimeout(() => setMinSplashDone(true), 1750);
    return () => clearTimeout(timer);
  }, [initializeApp]);

  // Smoothly dismiss and remove persistent DOM #rdx-splash once animation finishes
  useEffect(() => {
    if (minSplashDone) {
      const splash = document.getElementById("rdx-splash");
      if (splash) {
        splash.classList.add("rdx-splash-hide");
        const cleanup = setTimeout(() => {
          splash.remove();
        }, 550);
        return () => clearTimeout(cleanup);
      }
    }
  }, [minSplashDone]);

  // OTA GitHub Release Updater
  const handleCheckUpdates = useCallback(async (manual = false): Promise<boolean> => {
    try {
      const update = await checkForUpdates("1.1.2", manual);
      if (update) {
        setAvailableUpdate(update);
        setIsUpdateModalOpen(true);
        return true;
      }
      return false;
    } catch (err) {
      console.warn("OTA update check error:", err);
      return false;
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleCheckUpdates(false);
    }, 4500);
    return () => clearTimeout(timer);
  }, [handleCheckUpdates]);

  // Load "Continue Watching" row
  const refreshContinueWatching = useCallback(async () => {
    try {
      const items = await api.getContinueWatching(20);
      setContinueWatching(items);
    } catch (err) {
      console.warn("Failed to load continue watching items:", err);
    }
  }, []);

  useEffect(() => {
    refreshContinueWatching();
  }, [refreshContinueWatching]);

  // Handle Tab Switch (resets page and category filters)
  const handleTabChange = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    setCategoryPage(1);
    setActiveGenre(null);
    setActiveSort("last");
    setCategoryItems([]);
  }, []);

  // Filter & Sort Change Handlers
  const handleSortChange = useCallback((sort: string) => {
    setActiveSort(sort);
    setCategoryPage(1);
    setCategoryItems([]);
  }, []);

  const handleGenreChange = useCallback((genre: string | null) => {
    setActiveGenre(genre);
    setCategoryPage(1);
    setCategoryItems([]);
  }, []);

  // Open Details Modal
  const handleOpenDetails = useCallback(async (card: MediaCardType) => {
    setSelectedMediaForDetails(card);
    setIsDetailsOpen(true);
    try {
      const category = await api.isBookmarked(card.id);
      setIsCurrentBookmarked(Boolean(category));
    } catch {
      setIsCurrentBookmarked(false);
    }
  }, []);

  // Toggle Bookmark
  const handleToggleBookmark = useCallback(async (bookmark: Bookmark) => {
    try {
      const added = await api.toggleBookmark(bookmark);
      setIsCurrentBookmarked(added);
      setBookmarksRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to toggle bookmark:", err);
    }
  }, []);

  // Start Playback
  const handleStartPlayback = useCallback((
    details: MediaDetails,
    translatorId?: string,
    season?: number,
    episode?: number,
    positionSec?: number
  ) => {
    setActivePlayerDetails(details);
    setActiveTranslatorId(translatorId);
    setActiveSeason(season);
    setActiveEpisode(episode);
    setInitialPositionSec(positionSec || 0);
    setPlayerMode("full");
  }, []);

  // Play downloaded local file in VideoPlayer
  const handlePlayDownload = useCallback(async (item: DownloadItem) => {
    try {
      const allDownloads = await api.getDownloads();
      const mediaDownloads = allDownloads.filter(
        (d) => d.media_id === item.media_id && d.status === "completed"
      );

      // Unique translators from downloaded files
      const translatorsMap = new Map<string, Translator>();
      for (const d of mediaDownloads) {
        const tId = d.translator_id || "default";
        if (!translatorsMap.has(tId)) {
          translatorsMap.set(tId, {
            id: tId,
            name: d.translator_name || "Оригінал / За замовчуванням",
            language: "ukr",
            is_active: false,
          });
        }
      }
      const translators = Array.from(translatorsMap.values());

      // If series, populate seasons and episodes from local files
      const isSeries = item.media_type === "series" || item.season != null;
      const seasonsMap = new Set<number>();
      const episodesList: any[] = [];

      if (isSeries) {
        for (const d of mediaDownloads) {
          const sNum = d.season || 1;
          const eNum = d.episode || 1;
          seasonsMap.add(sNum);
          episodesList.push({
            id: `${sNum}_${eNum}`,
            season_id: String(sNum),
            episode_id: String(eNum),
            title: `Серія ${eNum}`,
            sub_title: d.translator_name || "",
          });
        }
      }

      const seasons = Array.from(seasonsMap)
        .sort((a, b) => a - b)
        .map((sNum) => ({
          id: String(sNum),
          title: `${sNum} сезон`,
        }));

      const assetUrl = convertFileSrc(item.file_path);
      const streamData: StreamData = {
        qualities: [
          {
            label: item.quality || "1080p",
            hls_url: null,
            mp4_url: assetUrl,
          },
        ],
        subtitles: [],
        default_quality: item.quality || "1080p",
        thumbnails: null,
      };

      const offlineDetails: MediaDetails = {
        id: item.media_id,
        url: "",
        title: item.title,
        orig_title: item.orig_title || null,
        poster: item.poster_url,
        high_res_poster: null,
        imdb_rating: null,
        kp_rating: null,
        description: `Офлайн-файл: ${item.file_path}`,
        info_table: [
          ["Формат", "MP4 (Офлайн)"],
          ["Якість", item.quality],
          ["Розмір", `${(item.total_bytes / (1024 * 1024)).toFixed(1)} MB`],
          ["Озвучення", item.translator_name || "За замовчуванням"],
        ],
        translators,
        seasons,
        episodes: episodesList,
        initial_streams: streamData,
        is_offline: true,
      };

      setActivePlayerDetails(offlineDetails);
      setActiveTranslatorId(item.translator_id || translators[0]?.id);
      setActiveSeason(item.season || 1);
      setActiveEpisode(item.episode || 1);
      setInitialPositionSec(0);
      setPlayerMode("full");
    } catch (err) {
      console.error("Failed to play offline download:", err);
    }
  }, []);

  // Handle in-player translator change for series
  const handlePlayerTranslatorChange = async (tId: string) => {
    setActiveTranslatorId(tId);
    if (!activePlayerDetails) return;
    if (activePlayerDetails.is_offline) return;

    if (activePlayerDetails.seasons && activePlayerDetails.seasons.length > 0) {
      try {
        const epData = await api.getEpisodes(
          activePlayerDetails.id,
          tId,
          activePlayerDetails.url
        );
        const updatedDetails: MediaDetails = {
          ...activePlayerDetails,
          seasons: epData.seasons,
          episodes: epData.episodes,
          initial_streams: epData.stream_data || activePlayerDetails.initial_streams,
        };
        setActivePlayerDetails(updatedDetails);

        // Check if currently activeSeason exists in new translator's seasons
        const seasonExists = epData.seasons.some(
          (s) => parseInt(s.id, 10) === activeSeason
        );
        if (!seasonExists && epData.seasons.length > 0) {
          const firstSeasonNum = parseInt(epData.seasons[0].id, 10);
          setActiveSeason(isNaN(firstSeasonNum) ? 1 : firstSeasonNum);
          setActiveEpisode(1);
          setInitialPositionSec(0);
        }
      } catch (err) {
        console.error("Failed to update episodes on translator change:", err);
      }
    }
  };

  // 1-Click direct play from MediaCard
  const handleDirectPlay = useCallback(async (card: MediaCardType) => {
    try {
      let details = await api.getMediaDetails(card.url);
      let saved = details.id
        ? await api.getWatchProgress(details.id).catch(() => null)
        : null;
      if (!saved && card.id && card.id !== details.id) {
        saved = await api.getWatchProgress(card.id).catch(() => null);
      }

      const isSeries = Boolean(
        (details.seasons && details.seasons.length > 0) || saved?.season
      );
      const translatorId =
        saved?.translator_id ||
        details.translators.find((t) => t.is_active)?.id ||
        details.translators[0]?.id;

      if (isSeries && translatorId) {
        try {
          const epData = await api.getEpisodes(details.id, translatorId, details.url);
          if (epData.episodes && epData.episodes.length > 0) {
            details = {
              ...details,
              seasons: epData.seasons.length > 0 ? epData.seasons : details.seasons,
              episodes: epData.episodes,
              initial_streams: epData.stream_data || details.initial_streams,
            };
          }
        } catch (epErr) {
          console.warn("Failed to fetch episodes for direct play translator:", epErr);
        }
      }

      const season = isSeries ? saved?.season || 1 : undefined;
      const episode = isSeries ? saved?.episode || 1 : undefined;
      const pos = saved?.position_sec || 0;

      handleStartPlayback(details, translatorId, season, episode, pos);
    } catch (e) {
      console.error("Direct play error:", e);
      handleOpenDetails(card);
    }
  }, [handleStartPlayback, handleOpenDetails]);

  // Resume from Continue Watching Card
  const handleResumeContinueWatching = useCallback(async (item: WatchProgress) => {
    try {
      let details = await api.getMediaDetails(item.media_url);

      const isSeries = Boolean(
        (details.seasons && details.seasons.length > 0) || item.season
      );
      const targetTranslator =
        item.translator_id ||
        details.translators.find((t) => t.is_active)?.id ||
        details.translators[0]?.id;

      if (isSeries && targetTranslator) {
        try {
          const epData = await api.getEpisodes(details.id, targetTranslator, details.url);
          if (epData.episodes && epData.episodes.length > 0) {
            details = {
              ...details,
              seasons: epData.seasons.length > 0 ? epData.seasons : details.seasons,
              episodes: epData.episodes,
              initial_streams: epData.stream_data || details.initial_streams,
            };
          }
        } catch (epErr) {
          console.warn("Failed to fetch episodes for resumed translator:", epErr);
        }
      }

      handleStartPlayback(
        details,
        targetTranslator,
        item.season || undefined,
        item.episode || undefined,
        item.position_sec
      );
    } catch (e) {
      console.error("Resume error:", e);
    }
  }, [handleStartPlayback]);

  // Remove from Continue Watching
  const handleRemoveContinueWatching = useCallback(async (mediaId: string) => {
    try {
      await api.deleteWatchProgress(mediaId);
      setContinueWatching((prev) => prev.filter((p) => p.media_id !== mediaId));
    } catch (e) {
      console.error("Failed to delete watch progress:", e);
    }
  }, []);

  // Memoized Hero Banner items from "Зараз дивляться" (Top-10 trending hits)
  const featuredHeroItems = useMemo(() => {
    const source = watchingHeroItems.length > 0 ? watchingHeroItems : homeItems;
    if (source.length === 0) return [];

    const valid = source.filter(
      (item) => item.title && item.poster && !item.poster.includes("placeholder")
    );

    const selected: MediaCardType[] = [];
    const seen = new Set<string>();

    for (const item of valid) {
      const key = item.id || item.url;
      if (!seen.has(key)) {
        seen.add(key);
        selected.push(item);
      }
      if (selected.length >= 10) break;
    }

    return selected.length > 0 ? selected : valid.slice(0, 10);
  }, [watchingHeroItems, homeItems]);

  const trendingHomeItems = useMemo(() => homeItems.slice(0, 18), [homeItems]);
  const filmsHomeItems = useMemo(
    () =>
      homeItems
        .filter(
          (i) =>
            !i.series_info &&
            !i.entity_type?.toLowerCase().includes("series") &&
            !i.entity_type?.toLowerCase().includes("аніме")
        )
        .slice(0, 18),
    [homeItems]
  );
  const seriesHomeItems = useMemo(
    () =>
      homeItems
        .filter(
          (i) =>
            i.series_info ||
            i.entity_type?.toLowerCase().includes("series") ||
            i.entity_type?.toLowerCase().includes("серіал")
        )
        .slice(0, 18),
    [homeItems]
  );
  const cartoonsHomeItems = useMemo(
    () =>
      homeItems
        .filter(
          (i) =>
            i.entity_type?.toLowerCase().includes("cartoon") ||
            i.entity_type?.toLowerCase().includes("anime") ||
            i.entity_type?.toLowerCase().includes("мульт") ||
            i.entity_type?.toLowerCase().includes("аніме")
        )
        .slice(0, 18),
    [homeItems]
  );
  const handleMoreFilms = useCallback(() => handleTabChange("films"), [handleTabChange]);
  const handleMoreSeries = useCallback(() => handleTabChange("series"), [handleTabChange]);
  const handleMoreCartoons = useCallback(() => handleTabChange("cartoons"), [handleTabChange]);

  const isBackgroundHidden = isDetailsOpen || Boolean(activePlayerDetails && playerMode === "full");

  // Close Video Player
  const handleClosePlayer = useCallback(() => {
    setActivePlayerDetails(null);
    refreshContinueWatching();
  }, [refreshContinueWatching]);

  return (
    <div className="min-h-screen bg-[var(--bg-base,#000000)] text-white flex flex-col font-sans selection:bg-rose-500/30 selection:text-white">
      {/* Top Android TV Navigation Bar */}
      {!isBackgroundHidden && (
        <TopBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenMirrorModal={() => setIsMirrorModalOpen(true)}
          onOpenSettings={() => setIsMirrorModalOpen(true)}
          mirrorStatus={mirrorStatus}
          activeMirrorUrl={settings?.active_mirror || "https://rezka-tv.org"}
          activeDownloadsCount={activeDownloadsCount}
        />
      )}

      {/* Main Content Area (hidden when full-screen Details or full-screen VideoPlayer is open so WebKit skips compositing 90 background cards) */}
      <main className={isBackgroundHidden ? "hidden" : "flex-1 flex flex-col pb-24"}>
        {activeTab === "bookmarks" ? (
          <BookmarksView
            onSelectMedia={handleOpenDetails}
            onPlayDirect={handleDirectPlay}
            refreshKey={`${bookmarksRefreshKey}-${isDetailsOpen}`}
          />
        ) : activeTab === "downloads" ? (
          <DownloadsView onPlayDownload={handlePlayDownload} />
        ) : catalogError ? (
          <div className="flex-1 flex flex-col items-center justify-center py-32 px-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-rose-950/40 border border-rose-500/30 flex items-center justify-center text-rose-500">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white">Помилка завантаження</h3>
            <p className="text-xs text-zinc-400 max-w-md">{catalogError}</p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                onClick={loadCatalog}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors cursor-pointer shadow-lg shadow-rose-950/50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Спробувати знову</span>
              </button>
              <button
                onClick={() => setActiveTab("downloads")}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs border border-white/10 transition-colors cursor-pointer shadow-lg"
              >
                <span>Офлайн-завантаження</span>
              </button>
              <button
                onClick={() => setIsMirrorModalOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/10 transition-colors cursor-pointer"
              >
                Налаштування дзеркал
              </button>
            </div>
          </div>
        ) : activeTab === "home" ? (
          loadingCatalog && trendingHomeItems.length === 0 ? (
            <>
              {/* Hero Banner Skeleton */}
              <div
                data-testid="hero-skeleton"
                className="w-full h-[52vh] min-h-[380px] max-h-[560px] bg-zinc-950 relative overflow-hidden flex items-end pb-12 px-[clamp(1.25rem,4vw,4rem)]"
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-zinc-950 via-zinc-900/40 to-zinc-950" />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base,#000000)] via-transparent to-transparent" />
                <div className="relative z-10 w-full max-w-2xl space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-6 w-20 rounded-lg bg-zinc-800/80 animate-pulse" />
                    <div className="h-6 w-28 rounded-lg bg-zinc-800/60 animate-pulse" />
                    <div className="h-6 w-16 rounded-lg bg-zinc-800/60 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-10 w-3/4 rounded-xl bg-zinc-800/90 animate-pulse" />
                    <div className="h-6 w-1/2 rounded-lg bg-zinc-800/60 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="h-3.5 w-full max-w-lg rounded-md bg-zinc-800/50 animate-pulse" />
                    <div className="h-3.5 w-4/5 max-w-md rounded-md bg-zinc-800/50 animate-pulse" />
                  </div>
                  <div className="flex items-center gap-3 pt-3">
                    <div className="h-12 w-44 rounded-2xl bg-rose-600/30 border border-rose-500/20 animate-pulse" />
                    <div className="h-12 w-36 rounded-2xl bg-zinc-800/80 border border-white/5 animate-pulse" />
                  </div>
                </div>
              </div>

              {/* 3 Skeleton Swimlane Rows */}
              <div className="space-y-4">
                <Swimlane
                  title="Завантаження..."
                  items={[]}
                  loading={true}
                  onSelectCard={() => {}}
                />
                <Swimlane
                  title="Завантаження..."
                  items={[]}
                  loading={true}
                  onSelectCard={() => {}}
                />
                <Swimlane
                  title="Завантаження..."
                  items={[]}
                  loading={true}
                  onSelectCard={() => {}}
                />
              </div>
            </>
          ) : (
            <>
              {/* Ambient Hero Banner Carousel */}
              <HeroBanner
                items={featuredHeroItems}
                onPlay={handleDirectPlay}
                onOpenDetails={handleOpenDetails}
              />

              {/* Special "Продовжити перегляд" Swimlane */}
              {continueWatching.length > 0 && (
                <ContinueWatchingSwimlane
                  items={continueWatching}
                  onResume={handleResumeContinueWatching}
                  onRemove={handleRemoveContinueWatching}
                  onOpenDetails={handleOpenDetails}
                />
              )}

              {/* Swimlanes for Home Rows */}
              <div className="space-y-4">
                <Swimlane
                  title="Популярне та оновлення"
                  badge="Сьогодні"
                  items={trendingHomeItems}
                  onSelectCard={handleOpenDetails}
                  onPlayDirect={handleDirectPlay}
                />

                {/* Categorized Swimlanes (Off-screen rows deferred via content-visibility: auto) */}
                <Swimlane
                  title="Фільми"
                  subtitle="Кращі кінопрем'єри"
                  items={filmsHomeItems}
                  onSelectCard={handleOpenDetails}
                  onPlayDirect={handleDirectPlay}
                  onMoreClick={handleMoreFilms}
                  className="cv-auto"
                />

                <Swimlane
                  title="Серіали"
                  subtitle="Популярні багатосерійні шоу"
                  items={seriesHomeItems}
                  onSelectCard={handleOpenDetails}
                  onPlayDirect={handleDirectPlay}
                  onMoreClick={handleMoreSeries}
                  className="cv-auto"
                />

                <Swimlane
                  title="Мультфільми та Аніме"
                  items={cartoonsHomeItems}
                  onSelectCard={handleOpenDetails}
                  onPlayDirect={handleDirectPlay}
                  onMoreClick={handleMoreCartoons}
                  className="cv-auto"
                />
              </div>
            </>
          )
        ) : (
          /* Category Grid View (Films / Series / Cartoons / Anime / New) */
          <div className="w-full px-[clamp(1.25rem,4vw,4rem)] py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight capitalize">
                {activeTab === "films"
                  ? "Фільми"
                  : activeTab === "series"
                  ? "Серіали"
                  : activeTab === "cartoons"
                  ? "Мультфільми"
                  : activeTab === "animation"
                  ? "Аніме"
                  : activeGenre === "films"
                  ? "Новинки: Фільми"
                  : activeGenre === "series"
                  ? "Новинки: Серіали"
                  : activeGenre === "cartoons"
                  ? "Новинки: Мультфільми"
                  : activeGenre === "animation"
                  ? "Новинки: Аніме"
                  : "Новинки кіно"}
              </h1>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  disabled={categoryPage <= 1}
                  onClick={() => {
                    playButtonClickSound();
                    setCategoryItems([]);
                    setCategoryPage((p) => Math.max(1, p - 1));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/10 text-xs font-semibold text-zinc-300 disabled:opacity-40 hover:text-white transition-colors cursor-pointer"
                >
                  Попередня
                </button>
                <span className="text-xs font-mono text-zinc-400">
                  Сторінка {categoryPage}
                </span>
                <button
                  onClick={() => {
                    playButtonClickSound();
                    setCategoryItems([]);
                    setCategoryPage((p) => p + 1);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/10 text-xs font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  Наступна
                </button>
              </div>
            </div>

            {/* HDRezka Category Filters & Genres Bar */}
            <CategoryFilterBar
              category={activeTab}
              activeSort={activeSort}
              onSortChange={handleSortChange}
              activeGenre={activeGenre}
              onGenreChange={handleGenreChange}
            />

            {loadingCatalog && categoryItems.length === 0 ? (
              <div
                data-testid="category-skeleton-grid"
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5"
              >
                {Array.from({ length: 12 }).map((_, idx) => (
                  <div key={idx} className="space-y-2.5">
                    <div className="aspect-[2/3] rounded-2xl bg-zinc-900/80 border border-white/5 animate-pulse bg-gradient-to-tr from-zinc-900 via-zinc-800/60 to-zinc-900" />
                    <div className="h-3.5 w-3/4 rounded-md bg-zinc-800/80 animate-pulse" />
                    <div className="h-2.5 w-1/2 rounded-md bg-zinc-900/80 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : categoryItems.length === 0 ? (
              <div className="py-24 text-center space-y-2">
                <p className="text-zinc-300 font-semibold text-base">Нічого не знайдено</p>
                <p className="text-zinc-500 text-xs max-w-sm mx-auto">
                  За обраним фільтром або жанром немає елементів. Спробуйте змінити сортування або скинути жанр.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(185px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
                {categoryItems.map((card) => (
                  <MediaCard
                    key={card.id || card.url}
                    card={card}
                    onSelect={handleOpenDetails}
                    onPlayDirect={handleDirectPlay}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Media Details Modal */}
      <MediaDetailsModal
        media={selectedMediaForDetails}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        onPlay={handleStartPlayback}
        onSelectMedia={handleOpenDetails}
        isBookmarked={isCurrentBookmarked}
        onToggleBookmark={handleToggleBookmark}
      />

      {/* Spotlight Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectMedia={handleOpenDetails}
      />

      {/* Mirror Manager & Network Settings Modal */}
      <MirrorModal
        isOpen={isMirrorModalOpen}
        onClose={() => setIsMirrorModalOpen(false)}
        onMirrorChanged={(newMirror) => {
          setSettings((prev) => (prev ? { ...prev, active_mirror: newMirror } : null));
          loadCatalog();
        }}
        onCheckUpdates={() => handleCheckUpdates(true)}
      />

      {/* OTA GitHub Release Auto-Updater Modal */}
      {availableUpdate && (
        <UpdateModal
          update={availableUpdate}
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
        />
      )}

      {/* Custom Cinema Video Player (Overlay / Docked Mini-Player / OS PiP) */}
      {activePlayerDetails && (
        <VideoPlayer
          details={activePlayerDetails}
          initialStreams={activePlayerDetails.initial_streams}
          activeTranslatorId={activeTranslatorId}
          activeSeason={activeSeason}
          activeEpisode={activeEpisode}
          initialPositionSec={initialPositionSec}
          mode={playerMode}
          onModeChange={setPlayerMode}
          onClose={handleClosePlayer}
          onEpisodeChange={(season, episode) => {
            setActiveSeason(season);
            setActiveEpisode(episode);
            setInitialPositionSec(0);
          }}
          onTranslatorChange={handlePlayerTranslatorChange}
        />
      )}
    </div>
  );
}
