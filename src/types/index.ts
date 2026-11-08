export interface AppSettings {
  active_mirror: string;
  custom_mirrors: string[];
  proxy_url: string;
  preferred_quality: string;
  preferred_translator: string;
  startup_sound?: boolean;
  autoplay_next?: boolean;
}

export interface EpisodeProgress {
  media_id: string;
  season: number;
  episode: number;
  position_sec: number;
  duration_sec: number;
  updated_at: number;
}

export interface WatchProgress {
  media_id: string;
  media_url: string;
  title: string;
  orig_title: string | null;
  poster_url: string;
  media_type: string;
  translator_id: string | null;
  translator_name: string | null;
  season: number | null;
  episode: number | null;
  position_sec: number;
  duration_sec: number;
  updated_at: number;
}

export interface Bookmark {
  media_id: string;
  media_url: string;
  title: string;
  poster_url: string;
  media_type: string;
  year_info: string | null;
  rating: string | null;
  category: string;
  added_at: number;
}

export interface MirrorStatus {
  mirror_url: string;
  online: boolean;
  latency_ms: number;
  status_message: string;
  doh_bypass?: boolean;
  catalog_available?: boolean;
}

export interface SmartRotationResult {
  selected_mirror: string;
  switched: boolean;
  statuses: MirrorStatus[];
}

export interface MediaCard {
  id: string;
  url: string;
  title: string;
  poster: string;
  entity_type: string;
  series_info: string | null;
  misc_info: string;
  rating: string | null;
}

export interface SearchItem {
  title: string;
  orig_title: string | null;
  year: string | null;
  entity_type: string | null;
  rating: string | null;
  url: string;
}

export interface Translator {
  id: string;
  name: string;
  language: string | null;
  is_active: boolean;
  is_premium?: boolean;
}

export interface SeasonTab {
  id: string;
  title: string;
}

export interface EpisodeTab {
  season_id: string;
  episode_id: string;
  title: string;
}

export interface StreamQuality {
  label: string;
  hls_url: string | null;
  mp4_url: string | null;
}

export interface SubtitleTrack {
  label: string;
  url: string;
}

export interface StreamData {
  qualities: StreamQuality[];
  default_quality: string;
  subtitles: SubtitleTrack[];
  thumbnails: string | null;
  is_premium?: boolean;
  cdn_host?: string;
  cdn_ping_ms?: number;
}

export interface TurboStats {
  enabled: boolean;
  port: number;
  buffered_mb: number;
  total_prefetched_mb: number;
  active_workers: number;
  cdn_mode: string;
}

export interface MediaDetails {
  id: string;
  url: string;
  title: string;
  orig_title: string | null;
  year?: string;
  countries?: string[];
  poster: string;
  high_res_poster: string | null;
  imdb_rating: string | null;
  kp_rating: string | null;
  description: string;
  info_table: [string, string][];
  translators: Translator[];
  seasons: SeasonTab[];
  episodes: EpisodeTab[];
  initial_streams: StreamData | null;
  is_offline?: boolean;
}

export interface EpisodesData {
  seasons: SeasonTab[];
  episodes: EpisodeTab[];
  stream_data: StreamData | null;
}

export interface DownloadItem {
  id: string;
  media_id: string;
  media_url: string;
  title: string;
  orig_title?: string | null;
  poster_url: string;
  media_type: string; // "movie", "series", "cartoon", "anime"
  genres: string;
  translator_id: string;
  translator_name: string;
  season?: number | null;
  episode?: number | null;
  quality: string;
  stream_url: string;
  file_path: string;
  temp_path: string;
  total_bytes: number;
  downloaded_bytes: number;
  speed_bytes_sec?: number;
  status: "queued" | "downloading" | "paused" | "completed" | "error";
  error_message?: string | null;
  created_at: number;
  completed_at?: number | null;
}

export interface DownloadProgressEvent {
  id: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bytes_sec: number;
  status: string;
}
