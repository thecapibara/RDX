import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import type {
  AppSettings,
  Bookmark,
  MediaCard as MediaCardType,
  MediaDetails,
  MirrorStatus,
  WatchProgress,
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
import { BookmarksView } from "./components/BookmarksView";
import { CategoryFilterBar } from "./components/CategoryFilterBar";
import { playButtonClickSound } from "./services/sound";

export default function App() {
  // Navigation & Settings State
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus | null>(null);

  // Catalog State
  const [isInitialBoot, setIsInitialBoot] = useState(true);
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

  // Load initial settings and mirror status
  const initializeApp = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      api.checkMirrorStatus(s.active_mirror)
        .then(setMirrorStatus)
        .catch(console.warn);
    } catch (e) {
      console.warn("Failed to get initial settings:", e);
    }
  }, []);

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
      } else if (activeTab !== "bookmarks") {
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
      setCatalogError(
        "Не вдалося з'єднатися з дзеркалом HDRezka. Будь ласка, перевірте дзеркало в налаштуваннях або відкрийте вікно Captcha Bridge."
      );
    } finally {
      setLoadingCatalog(false);
      setIsInitialBoot(false);
    }
  }, [activeTab, activeGenre, activeSort, categoryPage]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Handle Tab Switch (resets page and category filters)
  const handleTabChange = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    setCategoryPage(1);
    setActiveGenre(null);
    setActiveSort("last");
  }, []);

  // Filter & Sort Change Handlers
  const handleSortChange = useCallback((sort: string) => {
    setActiveSort(sort);
    setCategoryPage(1);
  }, []);

  const handleGenreChange = useCallback((genre: string | null) => {
    setActiveGenre(genre);
    setCategoryPage(1);
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

  // Handle in-player translator change for series
  const handlePlayerTranslatorChange = async (tId: string) => {
    setActiveTranslatorId(tId);
    if (!activePlayerDetails) return;

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
      const saved = await api.getWatchProgress(card.id).catch(() => null);

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
  const handleClosePlayer = () => {
    setActivePlayerDetails(null);
    refreshContinueWatching();
  };

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
        />
      )}

      {/* Main Content Area (hidden when full-screen Details or full-screen VideoPlayer is open so WebKit skips compositing 90 background cards) */}
      <main className={isBackgroundHidden ? "hidden" : "flex-1 flex flex-col pb-24"}>
        {activeTab === "bookmarks" ? (
          <BookmarksView
            onSelectMedia={handleOpenDetails}
            onPlayDirect={handleDirectPlay}
          />
        ) : loadingCatalog ? (
          !isInitialBoot ? (
            <div className="flex-1 flex flex-col items-center justify-center py-40 space-y-4">
              <Loader2 className="w-10 h-10 text-rose-500 animate-spin" />
            </div>
          ) : null
        ) : catalogError ? (
          <div className="flex-1 flex flex-col items-center justify-center py-32 px-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-rose-950/40 border border-rose-500/30 flex items-center justify-center text-rose-500">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white">Помилка завантаження</h3>
            <p className="text-xs text-zinc-400 max-w-md">{catalogError}</p>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={loadCatalog}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Спробувати знову</span>
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
                  : "Новинки кіно"}
              </h1>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  disabled={categoryPage <= 1}
                  onClick={() => {
                    playButtonClickSound();
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

            {loadingCatalog ? (
              <div className="py-24 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
                <p className="text-xs text-zinc-400 font-medium">Завантаження каталогу...</p>
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
      />

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
