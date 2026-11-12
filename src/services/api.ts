import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  Bookmark,
  DownloadItem,
  EpisodeProgress,
  EpisodesData,
  MediaCard,
  MediaDetails,
  MirrorStatus,
  SearchItem,
  SmartRotationResult,
  StreamData,
  WatchProgress,
} from "../types";

const isTauri =
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

// ==================== BROWSER DEMO / MOCK DATA ====================

const MOCK_STREAM_DATA: StreamData = {
  qualities: [
    {
      label: "1080p Ultra",
      hls_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      mp4_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    },
    {
      label: "1080p",
      hls_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      mp4_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    },
    {
      label: "720p",
      hls_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      mp4_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    },
    {
      label: "480p",
      hls_url: null,
      mp4_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    },
  ],
  default_quality: "1080p",
  subtitles: [
    {
      label: "Українські (Оригінал)",
      url: "data:text/vtt;charset=utf-8,WEBVTT%0A%0A1%0A00%3A00%3A01.000%20--%3E%2000%3A00%3A05.000%0A%D0%9F%D1%80%D0%B8%D1%94%D0%BC%D0%BD%D0%BE%D0%B3%D0%BE%20%D0%BF%D0%B5%D1%80%D0%B5%D0%B3%D0%BB%D1%8F%D0%B4%D1%83%20%D0%B2%20RDX!",
    },
  ],
  thumbnails: null,
};

const MOCK_CATALOG: MediaCard[] = [
  {
    id: "68352",
    url: "https://rezka-tv.org/films/fiction/68352-dyuna-chastina-druga-2024.html",
    title: "Дюна: Частина друга",
    poster: "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
    entity_type: "movie",
    series_info: null,
    misc_info: "2024, США, Фантастика, Пригоди",
    rating: "8.6",
  },
  {
    id: "54231",
    url: "https://rezka-tv.org/series/drama/54231-ostanni-z-nas-2023.html",
    title: "Останні з нас",
    poster: "https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2V7JMrRI.jpg",
    entity_type: "series",
    series_info: "2 сезон 1 серія",
    misc_info: "2023–2025, США, Драма, Жахи, Фантастика",
    rating: "8.8",
  },
  {
    id: "72140",
    url: "https://rezka-tv.org/films/action/72140-dedpul-i-rosomaha-2024.html",
    title: "Дедпул і Росомаха",
    poster: "https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
    entity_type: "movie",
    series_info: null,
    misc_info: "2024, США, Бойовик, Комедія",
    rating: "7.8",
  },
  {
    id: "47231",
    url: "https://rezka-tv.org/series/fiction/47231-dim-drakona-2022.html",
    title: "Дім Дракона",
    poster: "https://image.tmdb.org/t/p/w500/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg",
    entity_type: "series",
    series_info: "2 сезон 8 серія",
    misc_info: "2022–2024, США, Фентезі, Бойовик, Драма",
    rating: "8.4",
  },
  {
    id: "61245",
    url: "https://rezka-tv.org/cartoons/comedy/61245-dumkami-navivorit-2-2024.html",
    title: "Думками навиворіт 2",
    poster: "https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg",
    entity_type: "cartoon",
    series_info: null,
    misc_info: "2024, США, Мультфільм, Комедія, Сімейний",
    rating: "7.6",
  },
  {
    id: "52119",
    url: "https://rezka-tv.org/animation/action/52119-solo-leveling-2024.html",
    title: "Підняття рівня поодинці",
    poster: "https://image.tmdb.org/t/p/w500/geCRueV3ElhRTr0xtJuPxJ8ZXq5.jpg",
    entity_type: "anime",
    series_info: "2 сезон 6 серія",
    misc_info: "2024–2025, Японія, Аніме, Бойовик, Фентезі",
    rating: "8.5",
  },
  {
    id: "59124",
    url: "https://rezka-tv.org/films/action/59124-gladiator-2-2024.html",
    title: "Гладіатор 2",
    poster: "https://image.tmdb.org/t/p/w500/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg",
    entity_type: "movie",
    series_info: null,
    misc_info: "2024, США, Бойовик, Драма, Пригоди",
    rating: "7.1",
  },
  {
    id: "44120",
    url: "https://rezka-tv.org/series/comedy/44120-vedmid-the-bear-2022.html",
    title: "Ведмідь (The Bear)",
    poster: "https://image.tmdb.org/t/p/w500/53PecQn75727h6k1q3lU7P2m3pG.jpg",
    entity_type: "series",
    series_info: "3 сезон 10 серія",
    misc_info: "2022–2024, США, Драма, Комедія",
    rating: "8.6",
  },
];

function getStoredProgress(): WatchProgress[] {
  try {
    const raw = localStorage.getItem("rdx_watch_progress");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    {
      media_id: "68352",
      media_url: "https://rezka-tv.org/films/fiction/68352-dyuna-chastina-druga-2024.html",
      title: "Дюна: Частина друга",
      orig_title: "Dune: Part Two",
      poster_url: "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      media_type: "movie",
      translator_id: "1",
      translator_name: "Цікава Ідея (Укр)",
      season: null,
      episode: null,
      position_sec: 120,
      duration_sec: 634,
      updated_at: Math.floor(Date.now() / 1000) - 3600,
    },
    {
      media_id: "54231",
      media_url: "https://rezka-tv.org/series/drama/54231-ostanni-z-nas-2023.html",
      title: "Останні з нас",
      orig_title: "The Last of Us",
      poster_url: "https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2V7JMrRI.jpg",
      media_type: "series",
      translator_id: "1",
      translator_name: "Цікава Ідея (Укр)",
      season: 1,
      episode: 3,
      position_sec: 95,
      duration_sec: 634,
      updated_at: Math.floor(Date.now() / 1000) - 7200,
    },
  ];
}

function saveStoredProgress(items: WatchProgress[]) {
  try {
    localStorage.setItem("rdx_watch_progress", JSON.stringify(items));
  } catch {}
}

function getStoredBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem("rdx_bookmarks");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveStoredBookmarks(items: Bookmark[]) {
  try {
    localStorage.setItem("rdx_bookmarks", JSON.stringify(items));
  } catch {}
}

function upsertStoredEpisodeProgress(mediaId: string, item: EpisodeProgress) {
  try {
    const key = `rdx_episode_progress_${mediaId}`;
    const raw = localStorage.getItem(key);
    let list: EpisodeProgress[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((p) => p.season === item.season && p.episode === item.episode);
    if (idx >= 0) {
      list[idx] = item;
    } else {
      list.push(item);
    }
    list.sort((a, b) => (a.season === b.season ? a.episode - b.episode : a.season - b.season));
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

// ==================== UNIFIED API ====================

export const api = {
  // Settings & Storage
  getSettings: async (): Promise<AppSettings> => {
    if (isTauri) return invoke<AppSettings>("get_settings");
    try {
      const raw = localStorage.getItem("rdx_settings");
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      active_mirror: "https://rezka-tv.org",
      custom_mirrors: ["https://hdrezka.me", "https://rezka.ag"],
      proxy_url: "",
      preferred_quality: "720p",
      preferred_translator: "Українська",
      autoplay_next: true,
    };
  },

  updateSettings: async (settings: AppSettings): Promise<void> => {
    if (isTauri) return invoke<void>("update_settings", { settings });
    localStorage.setItem("rdx_settings", JSON.stringify(settings));
  },

  // Watch Progress
  saveWatchProgress: async (progress: WatchProgress): Promise<void> => {
    if (progress.season != null && progress.episode != null) {
      upsertStoredEpisodeProgress(progress.media_id, {
        media_id: progress.media_id,
        season: progress.season,
        episode: progress.episode,
        position_sec: progress.position_sec,
        duration_sec: progress.duration_sec,
        updated_at: progress.updated_at,
      });
    }

    if (isTauri) return invoke<void>("save_watch_progress", { progress });
    const items = getStoredProgress().filter((p) => p.media_id !== progress.media_id);
    items.unshift(progress);
    saveStoredProgress(items.slice(0, 50));
  },

  getWatchProgress: async (mediaId: string): Promise<WatchProgress | null> => {
    if (isTauri) return invoke<WatchProgress | null>("get_watch_progress", { mediaId });
    return getStoredProgress().find((p) => p.media_id === mediaId) || null;
  },

  getContinueWatching: async (limit = 20): Promise<WatchProgress[]> => {
    if (isTauri) return invoke<WatchProgress[]>("get_continue_watching", { limit });
    return getStoredProgress().slice(0, limit);
  },

  deleteWatchProgress: async (mediaId: string): Promise<boolean> => {
    try {
      localStorage.removeItem(`rdx_episode_progress_${mediaId}`);
    } catch {}
    if (isTauri) return invoke<boolean>("delete_watch_progress", { mediaId });
    const items = getStoredProgress().filter((p) => p.media_id !== mediaId);
    saveStoredProgress(items);
    return true;
  },

  getEpisodeProgress: async (mediaId: string): Promise<EpisodeProgress[]> => {
    if (isTauri) return invoke<EpisodeProgress[]>("get_episode_progress", { mediaId });
    try {
      const raw = localStorage.getItem(`rdx_episode_progress_${mediaId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}

    if (mediaId === "54231") {
      const mockList: EpisodeProgress[] = [
        {
          media_id: "54231",
          season: 1,
          episode: 1,
          position_sec: 600,
          duration_sec: 634,
          updated_at: Math.floor(Date.now() / 1000) - 10000,
        },
        {
          media_id: "54231",
          season: 1,
          episode: 2,
          position_sec: 610,
          duration_sec: 634,
          updated_at: Math.floor(Date.now() / 1000) - 8000,
        },
        {
          media_id: "54231",
          season: 1,
          episode: 3,
          position_sec: 95,
          duration_sec: 634,
          updated_at: Math.floor(Date.now() / 1000) - 7200,
        },
      ];
      try {
        localStorage.setItem(`rdx_episode_progress_${mediaId}`, JSON.stringify(mockList));
      } catch {}
      return mockList;
    }
    return [];
  },

  // Bookmarks
  toggleBookmark: async (bookmark: Bookmark): Promise<boolean> => {
    if (isTauri) return invoke<boolean>("toggle_bookmark", { bookmark });
    const items = getStoredBookmarks();
    const index = items.findIndex((b) => b.media_id === bookmark.media_id);
    if (index >= 0) {
      items.splice(index, 1);
      saveStoredBookmarks(items);
      return false;
    } else {
      items.unshift(bookmark);
      saveStoredBookmarks(items);
      return true;
    }
  },

  getBookmarks: async (category?: string): Promise<Bookmark[]> => {
    if (isTauri) return invoke<Bookmark[]>("get_bookmarks", { category });
    const items = getStoredBookmarks();
    if (!category || category === "all") return items;
    return items.filter((b) => b.category === category);
  },

  isBookmarked: async (mediaId: string): Promise<string | null> => {
    if (isTauri) return invoke<string | null>("is_bookmarked", { mediaId });
    const found = getStoredBookmarks().find((b) => b.media_id === mediaId);
    return found ? found.category : null;
  },

  // Mirror Management
  checkMirrorStatus: async (mirrorUrl: string): Promise<MirrorStatus> => {
    if (isTauri) return invoke<MirrorStatus>("check_mirror_status", { mirrorUrl });
    return {
      mirror_url: mirrorUrl,
      online: true,
      latency_ms: 38,
      status_message: "OK • Пряме",
      doh_bypass: false,
      catalog_available: true,
    };
  },

  checkAllMirrors: async (mirrorUrls: string[]): Promise<MirrorStatus[]> => {
    if (isTauri) return invoke<MirrorStatus[]>("check_all_mirrors", { mirrorUrls });
    return mirrorUrls.map((url, idx) => ({
      mirror_url: url,
      online: true,
      latency_ms: 38 + idx * 14,
      status_message: idx === 0 ? "OK • Пряме" : "OK • DoH обхід",
      doh_bypass: idx > 0,
      catalog_available: true,
    }));
  },

  smartSelectMirror: async (forceRotate = false): Promise<SmartRotationResult> => {
    if (isTauri) return invoke<SmartRotationResult>("smart_select_mirror", { forceRotate });
    return {
      selected_mirror: "https://rezka-tv.org",
      switched: false,
      statuses: [
        {
          mirror_url: "https://rezka-tv.org",
          online: true,
          latency_ms: 38,
          status_message: "OK • Пряме",
          doh_bypass: false,
          catalog_available: true,
        },
      ],
    };
  },

  getActiveMirror: async (): Promise<string> => {
    if (isTauri) return invoke<string>("get_active_mirror");
    const s = await api.getSettings();
    return s.active_mirror;
  },

  setActiveMirror: async (mirrorUrl: string): Promise<void> => {
    if (isTauri) return invoke<void>("set_active_mirror", { mirrorUrl });
    const s = await api.getSettings();
    s.active_mirror = mirrorUrl;
    await api.updateSettings(s);
  },

  openCaptchaWindow: async (mirrorUrl?: string): Promise<void> => {
    if (isTauri) return invoke<void>("open_captcha_window", { mirrorUrl });
    window.open(mirrorUrl || "https://rezka-tv.org", "_blank");
  },

  // Catalog & Search
  getHomeCatalog: async (filter?: string, genre?: string, page?: number): Promise<MediaCard[]> => {
    if (isTauri) return invoke<MediaCard[]>("get_home_catalog", { filter, genre, page });
    return MOCK_CATALOG;
  },

  getCategoryCatalog: async (
    category: string,
    genre?: string,
    filter?: string,
    page?: number
  ): Promise<MediaCard[]> => {
    if (isTauri)
      return invoke<MediaCard[]>("get_category_catalog", {
        category,
        genre: genre || undefined,
        filter: filter || undefined,
        page,
      });
    if (category === "films") {
      return MOCK_CATALOG.filter((i) => i.entity_type === "movie");
    }
    if (category === "series") {
      return MOCK_CATALOG.filter((i) => i.entity_type === "series");
    }
    if (category === "cartoons") {
      return MOCK_CATALOG.filter((i) => i.entity_type === "cartoon");
    }
    if (category === "animation") {
      return MOCK_CATALOG.filter((i) => i.entity_type === "anime");
    }
    return MOCK_CATALOG;
  },

  searchMedia: async (query: string): Promise<MediaCard[]> => {
    if (isTauri) return invoke<MediaCard[]>("search_media", { query });
    const q = query.toLowerCase();
    return MOCK_CATALOG.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.misc_info.toLowerCase().includes(q)
    );
  },

  searchAutocomplete: async (query: string): Promise<SearchItem[]> => {
    if (isTauri) return invoke<SearchItem[]>("search_autocomplete", { query });
    const q = query.toLowerCase();
    return MOCK_CATALOG.filter((m) => m.title.toLowerCase().includes(q)).map((m) => ({
      title: m.title,
      orig_title: null,
      year: m.misc_info.split(",")[0] || "2024",
      entity_type: m.entity_type === "series" ? "Серіал" : "Фільм",
      rating: m.rating,
      url: m.url,
    }));
  },

  // Media Details & Streaming
  getMediaDetails: async (itemUrl: string): Promise<MediaDetails> => {
    if (isTauri) return invoke<MediaDetails>("get_media_details", { itemUrl });
    const found = MOCK_CATALOG.find((m) => m.url === itemUrl) || MOCK_CATALOG[0];
    const isSeries = found.entity_type === "series";

    return {
      id: found.id,
      url: found.url,
      title: found.title,
      orig_title: isSeries ? "The Last of Us" : "Dune: Part Two",
      poster: found.poster,
      high_res_poster: found.poster,
      imdb_rating: found.rating || "8.5",
      kp_rating: "8.3",
      description:
        "Захоплююча кіноісторія з неймовірними візуальними ефектами, глибоким сюжетом та бездоганним українським дубляжем. Доступна у якості до 1080p Ultra та 4K з багатоканальним звуком.",
      info_table: [
        ["Рік випуску", "2024"],
        ["Країна", "США, Канада"],
        ["Жанр", found.misc_info],
        ["Якість", "1080p Ultra / 4K"],
        ["Тривалість", isSeries ? "55 хв." : "166 хв."],
      ],
      translators: [
        {
          id: "1",
          name: "Цікава Ідея (Укр)",
          language: "Украинский",
          is_active: true,
        },
        {
          id: "2",
          name: "НеЗупиняйСкорочення (Укр)",
          language: "Українська",
          is_active: false,
        },
        {
          id: "3",
          name: "HDRezka Studio",
          language: "Русский",
          is_active: false,
        },
        {
          id: "4",
          name: "Original (English)",
          language: "Английский",
          is_active: false,
        },
      ],
      seasons: isSeries
        ? [
            { id: "1", title: "1 сезон" },
            { id: "2", title: "2 сезон" },
          ]
        : [],
      episodes: isSeries
        ? [
            { season_id: "1", episode_id: "1", title: "1 серія" },
            { season_id: "1", episode_id: "2", title: "2 серія" },
            { season_id: "1", episode_id: "3", title: "3 серія" },
            { season_id: "1", episode_id: "4", title: "4 серія" },
            { season_id: "1", episode_id: "5", title: "5 серія" },
            { season_id: "1", episode_id: "6", title: "6 серія" },
            { season_id: "1", episode_id: "7", title: "7 серія" },
            { season_id: "1", episode_id: "8", title: "8 серія" },
            { season_id: "2", episode_id: "1", title: "1 серія" },
            { season_id: "2", episode_id: "2", title: "2 серія" },
          ]
        : [],
      initial_streams: MOCK_STREAM_DATA,
    };
  },

  getStream: async (
    mediaId: string,
    refererUrl: string,
    isSeries: boolean,
    translatorId?: string,
    season?: number,
    episode?: number
  ): Promise<StreamData> => {
    if (isTauri) {
      return invoke<StreamData>("get_stream", {
        mediaId,
        translatorId,
        season,
        episode,
        isSeries,
        refererUrl,
      });
    }
    return MOCK_STREAM_DATA;
  },

  getEpisodes: async (
    mediaId: string,
    translatorId: string,
    refererUrl: string
  ): Promise<EpisodesData> => {
    if (isTauri) {
      return invoke<EpisodesData>("get_episodes", {
        mediaId,
        translatorId,
        refererUrl,
      });
    }
    return {
      seasons: [
        { id: "1", title: "1 сезон" },
        { id: "2", title: "2 сезон" },
      ],
      episodes: [
        { season_id: "1", episode_id: "1", title: "1 серія" },
        { season_id: "1", episode_id: "2", title: "2 серія" },
        { season_id: "1", episode_id: "3", title: "3 серія" },
        { season_id: "1", episode_id: "4", title: "4 серія" },
        { season_id: "2", episode_id: "1", title: "1 серія" },
      ],
      stream_data: MOCK_STREAM_DATA,
    };
  },

  // Window & Player Helpers
  setMiniPlayerMode: async (enabled: boolean): Promise<void> => {
    if (isTauri) return invoke<void>("set_mini_player_mode", { enabled });
  },

  setFullscreenMode: async (enabled: boolean): Promise<boolean> => {
    if (isTauri) return invoke<boolean>("set_fullscreen_mode", { enabled });
    return enabled;
  },

  startDragWindow: async (): Promise<void> => {
    if (isTauri) return invoke<void>("start_drag_window");
  },

  openInExternalPlayer: async (
    streamUrl: string,
    positionSec?: number,
    title?: string
  ): Promise<void> => {
    if (isTauri) {
      return invoke<void>("open_in_external_player", {
        streamUrl,
        positionSec,
        title,
      });
    }
    window.open(streamUrl, "_blank");
  },

  // MPRIS Remote Controls (Native OS Media Integration)
  updateMprisState: async (payload: {
    title: string;
    artist?: string;
    album?: string;
    poster?: string;
    durationSec?: number;
    positionSec?: number;
    isPlaying: boolean;
  }): Promise<void> => {
    if (isTauri) {
      return invoke<void>("update_mpris_state", {
        title: payload.title,
        artist: payload.artist || null,
        album: payload.album || null,
        poster: payload.poster || null,
        durationSec: payload.durationSec || null,
        positionSec: payload.positionSec || null,
        isPlaying: payload.isPlaying,
      });
    }
  },

  clearMprisState: async (): Promise<void> => {
    if (isTauri) {
      return invoke<void>("clear_mpris_state");
    }
  },

  playStartupSound: async (volume?: number): Promise<void> => {
    if (isTauri) {
      return invoke<void>("play_startup_sound", { volume });
    }
  },

  playUiSound: async (
    soundType: "hover" | "modal_open" | "button_click"
  ): Promise<void> => {
    if (isTauri) {
      return invoke<void>("play_ui_sound", { soundType }).catch(() => {});
    }
  },

  // ==================== Downloads API ====================
  startDownload: async (params: {
    mediaId: string;
    mediaUrl: string;
    title: string;
    origTitle?: string | null;
    posterUrl: string;
    mediaType: string;
    genres: string;
    translatorId: string;
    translatorName: string;
    season?: number | null;
    episode?: number | null;
    quality: string;
    streamUrl: string;
  }): Promise<DownloadItem> => {
    if (isTauri) {
      return invoke<DownloadItem>("start_download", {
        mediaId: params.mediaId,
        mediaUrl: params.mediaUrl,
        title: params.title,
        origTitle: params.origTitle || null,
        posterUrl: params.posterUrl,
        mediaType: params.mediaType,
        genres: params.genres,
        translatorId: params.translatorId,
        translatorName: params.translatorName,
        season: params.season ?? null,
        episode: params.episode ?? null,
        quality: params.quality,
        streamUrl: params.streamUrl,
      });
    }
    throw new Error("Downloads are only supported in desktop mode");
  },

  pauseDownload: async (id: string): Promise<void> => {
    if (isTauri) {
      return invoke<void>("pause_download", { id });
    }
  },

  resumeDownload: async (id: string): Promise<void> => {
    if (isTauri) {
      return invoke<void>("resume_download", { id });
    }
  },

  cancelDownload: async (id: string): Promise<void> => {
    if (isTauri) {
      return invoke<void>("cancel_download", { id });
    }
  },

  deleteDownload: async (id: string): Promise<void> => {
    if (isTauri) {
      return invoke<void>("delete_download", { id });
    }
  },

  getDownloads: async (): Promise<DownloadItem[]> => {
    if (isTauri) {
      return invoke<DownloadItem[]>("get_downloads");
    }
    return [];
  },

  getDownloadsDir: async (): Promise<string> => {
    if (isTauri) {
      return invoke<string>("get_downloads_dir");
    }
    return "";
  },

  pauseAllDownloads: async (): Promise<void> => {
    if (isTauri) {
      return invoke<void>("pause_all_downloads");
    }
  },

  resumeAllDownloads: async (): Promise<void> => {
    if (isTauri) {
      return invoke<void>("resume_all_downloads");
    }
  },

  clearCompletedDownloads: async (): Promise<void> => {
    if (isTauri) {
      return invoke<void>("clear_completed_downloads");
    }
  },

  showInFolder: async (path: string): Promise<void> => {
    if (isTauri) {
      return invoke<void>("show_in_folder", { path });
    }
  },

  openUrl: async (url: string): Promise<void> => {
    if (isTauri) {
      try {
        await invoke<void>("open_url", { url });
        return;
      } catch (err) {
        console.warn("Native open_url failed, falling back to window.open:", err);
      }
    }
    window.open(url, "_blank");
  },

  getTurboStreamUrl: async (rawUrl: string): Promise<string> => {
    if (isTauri) {
      return invoke<string>("get_turbo_stream_url", { rawUrl });
    }
    return rawUrl;
  },

  getTurboStats: async (): Promise<any> => {
    if (isTauri) {
      return invoke<any>("get_turbo_stats");
    }
    return { enabled: false, port: 0, buffered_mb: 0, total_prefetched_mb: 0, active_workers: 0, cdn_mode: "Off" };
  },

  selectFastestCdn: async (streamUrl: string): Promise<[string, number]> => {
    if (isTauri) {
      return invoke<[string, number]>("select_fastest_cdn", { streamUrl });
    }
    return ["auto", 0];
  },

  getBackdrop: async (
    title: string,
    origTitle?: string,
    year?: string,
    mediaType?: "movie" | "tv"
  ): Promise<string | null> => {
    if (isTauri) {
      try {
        return await invoke<string | null>("get_backdrop", {
          title,
          origTitle,
          year,
          mediaType,
        });
      } catch (e) {
        console.warn("[TMDB] Failed to get backdrop:", e);
        return null;
      }
    }
    return null;
  },

  getSystemTime: async (): Promise<string> => {
    if (isTauri) {
      try {
        return await invoke<string>("get_system_time");
      } catch {
        // Fall back to JS clock if invocation fails
      }
    }
    const now = new Date();
    return now.toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  },
};
