use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder};
use serde::{Deserialize, Serialize};

use crate::client::HttpClient;
use crate::downloader::{get_downloads_dir as resolve_downloads_dir, DownloadManager};
use crate::mirror::{MirrorManager, MirrorStatus, SmartRotationResult, PRESET_MIRRORS};
use crate::parser::{
    EpisodeTab, MediaCard, MediaDetails, RezkaParser, SearchItem, SeasonTab, StreamData,
};
use crate::storage::{AppSettings, Bookmark, DownloadItem, EpisodeProgress, Storage, WatchProgress};

pub struct AppState {
    pub storage: Arc<Storage>,
    pub client: Arc<HttpClient>,
    pub mpris: Arc<crate::mpris::MprisState>,
    pub downloader: Arc<DownloadManager>,
    pub turbo: Arc<crate::turbo::TurboServer>,
    pub tmdb: Arc<crate::tmdb::TmdbService>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodesData {
    pub seasons: Vec<SeasonTab>,
    pub episodes: Vec<EpisodeTab>,
    pub stream_data: Option<StreamData>,
}

// ==================== Storage Commands ====================

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.storage.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    state.client.set_proxy(Some(&settings.proxy_url));
    state.storage.update_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_watch_progress(state: State<'_, AppState>, progress: WatchProgress) -> Result<(), String> {
    state.storage.save_watch_progress(&progress).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_watch_progress(state: State<'_, AppState>, media_id: String) -> Result<Option<WatchProgress>, String> {
    state.storage.get_watch_progress(&media_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_continue_watching(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<WatchProgress>, String> {
    state.storage.get_continue_watching(limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_watch_progress(state: State<'_, AppState>, media_id: String) -> Result<bool, String> {
    state.storage.delete_watch_progress(&media_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_episode_progress(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<Vec<EpisodeProgress>, String> {
    state.storage.get_episode_progress(&media_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_bookmark(state: State<'_, AppState>, bookmark: Bookmark) -> Result<bool, String> {
    state.storage.toggle_bookmark(&bookmark).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bookmarks(state: State<'_, AppState>, category: Option<String>) -> Result<Vec<Bookmark>, String> {
    state.storage.get_bookmarks(category.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn is_bookmarked(state: State<'_, AppState>, media_id: String) -> Result<Option<String>, String> {
    state.storage.is_bookmarked(&media_id).map_err(|e| e.to_string())
}

// ==================== Downloads Commands ====================

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    media_id: String,
    media_url: String,
    title: String,
    orig_title: Option<String>,
    poster_url: String,
    media_type: String,
    genres: String,
    translator_id: String,
    translator_name: String,
    season: Option<i32>,
    episode: Option<i32>,
    quality: String,
    stream_url: String,
) -> Result<DownloadItem, String> {
    let clean_title = title
        .replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-', "")
        .trim()
        .replace(' ', "_");
    let ep_suffix = if let (Some(s), Some(e)) = (season, episode) {
        format!("_s{:02}e{:02}", s, e)
    } else {
        String::new()
    };
    let clean_trans = translator_name
        .replace(|c: char| !c.is_alphanumeric() && c != '-', "")
        .trim()
        .replace(' ', "_");

    let downloads_dir = resolve_downloads_dir();
    let filename_base = format!("{}_{}{}_{}", clean_title, clean_trans, ep_suffix, quality);
    let final_path = downloads_dir.join(format!("{}.mp4", filename_base));
    let temp_path = downloads_dir.join(format!("{}.part", filename_base));

    let id = format!(
        "{}_{}_{}_{}_{}",
        media_id,
        translator_id,
        quality,
        season.unwrap_or(0),
        episode.unwrap_or(0)
    );

    let item = DownloadItem {
        id,
        media_id,
        media_url,
        title,
        orig_title,
        poster_url,
        media_type,
        genres,
        translator_id,
        translator_name,
        season,
        episode,
        quality,
        stream_url,
        file_path: final_path.to_string_lossy().to_string(),
        temp_path: temp_path.to_string_lossy().to_string(),
        total_bytes: 0,
        downloaded_bytes: 0,
        status: "downloading".to_string(),
        error_message: None,
        created_at: chrono::Utc::now().timestamp_millis(),
        completed_at: None,
        speed_bytes_sec: Some(0),
    };

    state.downloader.start_download(item, app).await
}

#[tauri::command]
pub async fn pause_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.downloader.pause_download(&id, app)
}

#[tauri::command]
pub async fn resume_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.downloader.resume_download(&id, app).await
}

#[tauri::command]
pub async fn cancel_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.downloader.cancel_download(&id, app).await
}

#[tauri::command]
pub async fn delete_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.downloader.delete_download(&id, app).await
}

#[tauri::command]
pub async fn get_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadItem>, String> {
    let mut items = state.storage.get_downloads().map_err(|e| e.to_string())?;
    let active = state.downloader.get_all_active_progress();
    for item in &mut items {
        if let Some(prog) = active.get(&item.id) {
            item.downloaded_bytes = prog.downloaded_bytes;
            if prog.total_bytes > 0 {
                item.total_bytes = prog.total_bytes;
            }
            item.speed_bytes_sec = Some(prog.speed_bytes_sec);
            item.status = prog.status.clone();
        }
    }
    Ok(items)
}

#[tauri::command]
pub async fn get_downloads_dir() -> Result<String, String> {
    Ok(resolve_downloads_dir().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn pause_all_downloads(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.downloader.pause_all(app)
}

#[tauri::command]
pub async fn resume_all_downloads(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.downloader.resume_all(app)
}

#[tauri::command]
pub async fn clear_completed_downloads(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.downloader.clear_completed(app)
}

#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);

    #[cfg(target_os = "windows")]
    {
        if p.exists() && p.is_file() {
            let _ = std::process::Command::new("explorer")
                .arg(format!("/select,{}", path))
                .spawn();
        } else {
            let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
            let _ = std::process::Command::new("explorer")
                .arg(target)
                .spawn();
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        if p.exists() && p.is_file() {
            let _ = std::process::Command::new("open")
                .arg("-R")
                .arg(&path)
                .spawn();
        } else {
            let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
            let _ = std::process::Command::new("open")
                .arg(target)
                .spawn();
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let target = if p.exists() && p.is_dir() {
            p
        } else {
            p.parent().unwrap_or(p)
        };
        let _ = std::process::Command::new("xdg-open")
            .arg(target)
            .spawn();
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ==================== Mirror Commands ====================

#[tauri::command]
pub async fn check_mirror_status(state: State<'_, AppState>, mirror_url: String) -> Result<MirrorStatus, String> {
    let status = MirrorManager::check_mirror_status(&state.client, &mirror_url).await;
    Ok(status)
}

#[tauri::command]
pub async fn check_all_mirrors(
    state: State<'_, AppState>,
    mirror_urls: Vec<String>,
) -> Result<Vec<MirrorStatus>, String> {
    let statuses = MirrorManager::check_all_mirrors(state.client.clone(), mirror_urls).await;
    Ok(statuses)
}

#[tauri::command]
pub async fn smart_select_mirror(
    state: State<'_, AppState>,
    force_rotate: Option<bool>,
) -> Result<SmartRotationResult, String> {
    let mut settings = state.storage.get_settings().map_err(|e| e.to_string())?;
    let current_active = MirrorManager::normalize_url(&settings.active_mirror);

    let mut extra = vec![current_active.clone()];
    for m in &settings.custom_mirrors {
        extra.push(m.clone());
    }

    let statuses = MirrorManager::discover_mirrors(state.client.clone(), &extra).await;

    // Persist any newly discovered working public mirrors into custom_mirrors
    let preset_set: Vec<String> = PRESET_MIRRORS.iter().map(|s| s.to_string()).collect();
    let mut custom_changed = false;
    for st in &statuses {
        if st.online
            && st.catalog_available
            && !preset_set.contains(&st.mirror_url)
            && !settings.custom_mirrors.contains(&st.mirror_url)
        {
            settings.custom_mirrors.push(st.mirror_url.clone());
            custom_changed = true;
        }
    }

    let working: Vec<&MirrorStatus> = statuses
        .iter()
        .filter(|s| s.online && s.catalog_available)
        .collect();

    let chosen = if force_rotate.unwrap_or(false) && working.len() > 1 {
        working
            .iter()
            .find(|s| s.mirror_url != current_active)
            .copied()
            .or_else(|| working.first().copied())
    } else {
        working.first().copied()
    };

    let (selected_mirror, switched) = if let Some(best) = chosen {
        let changed = best.mirror_url != current_active;
        if changed || custom_changed {
            settings.active_mirror = best.mirror_url.clone();
            let _ = state.storage.update_settings(&settings);
        }
        (best.mirror_url.clone(), changed)
    } else {
        if custom_changed {
            let _ = state.storage.update_settings(&settings);
        }
        (current_active, false)
    };

    Ok(SmartRotationResult {
        selected_mirror,
        switched,
        statuses,
    })
}

#[tauri::command]
pub async fn get_active_mirror(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.storage.get_settings().map_err(|e| e.to_string())?;
    Ok(settings.active_mirror)
}

#[tauri::command]
pub async fn set_active_mirror(state: State<'_, AppState>, mirror_url: String) -> Result<(), String> {
    let mut settings = state.storage.get_settings().map_err(|e| e.to_string())?;
    settings.active_mirror = MirrorManager::normalize_url(&mirror_url);
    state.storage.update_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_captcha_window(app_handle: AppHandle, state: State<'_, AppState>, mirror_url: Option<String>) -> Result<(), String> {
    let target_url = if let Some(url) = mirror_url {
        url
    } else {
        state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror
    };

    let parsed_url: url::Url = target_url.parse().map_err(|e: url::ParseError| e.to_string())?;
    let window_url = WebviewUrl::External(parsed_url);

    WebviewWindowBuilder::new(&app_handle, "captcha_bridge", window_url)
        .title("RDX — Перевірка захисту")
        .inner_size(860.0, 680.0)
        .resizable(true)
        .build()
        .map_err(|e| format!("Failed to open captcha window: {}", e))?;

    Ok(())
}

// ==================== Parser & Streaming Commands ====================

async fn failover_to_best_mirror(state: &AppState, failed_mirror: &str) -> Option<String> {
    let mut settings = state.storage.get_settings().ok()?;
    let failed_norm = MirrorManager::normalize_url(failed_mirror);

    let mut extra = vec![MirrorManager::normalize_url(&settings.active_mirror)];
    for m in &settings.custom_mirrors {
        extra.push(m.clone());
    }

    let statuses = MirrorManager::discover_mirrors(state.client.clone(), &extra).await;

    // Persist any newly discovered working public mirrors into custom_mirrors
    let preset_set: Vec<String> = PRESET_MIRRORS.iter().map(|s| s.to_string()).collect();
    for st in &statuses {
        if st.online
            && st.catalog_available
            && !preset_set.contains(&st.mirror_url)
            && !settings.custom_mirrors.contains(&st.mirror_url)
        {
            settings.custom_mirrors.push(st.mirror_url.clone());
        }
    }

    let mut candidates: Vec<&MirrorStatus> = statuses
        .iter()
        .filter(|s| s.online && s.catalog_available && s.mirror_url != failed_norm)
        .collect();

    candidates.sort_by(|a, b| {
        b.stream_available
            .cmp(&a.stream_available)
            .then_with(|| b.health_score.cmp(&a.health_score))
            .then_with(|| a.latency_ms.cmp(&b.latency_ms))
    });

    let best = candidates.first()?;
    let best_url = best.mirror_url.clone();

    settings.active_mirror = best_url.clone();
    let _ = state.storage.update_settings(&settings);

    Some(best_url)
}

#[tauri::command]
pub async fn get_home_catalog(
    state: State<'_, AppState>,
    filter: Option<String>,
    genre: Option<String>,
    page: Option<u32>,
) -> Result<Vec<MediaCard>, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    RezkaParser::get_home_catalog(&state.client, &mirror, filter.as_deref(), genre.as_deref(), page)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_category_catalog(
    state: State<'_, AppState>,
    category: String,
    genre: Option<String>,
    filter: Option<String>,
    page: Option<u32>,
) -> Result<Vec<MediaCard>, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    RezkaParser::get_category_catalog(
        &state.client,
        &mirror,
        &category,
        genre.as_deref(),
        filter.as_deref(),
        page,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_media(state: State<'_, AppState>, query: String) -> Result<Vec<MediaCard>, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    RezkaParser::search_media(&state.client, &mirror, &query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_autocomplete(state: State<'_, AppState>, query: String) -> Result<Vec<SearchItem>, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    RezkaParser::search_autocomplete(&state.client, &mirror, &query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_media_details(state: State<'_, AppState>, item_url: String) -> Result<MediaDetails, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    let start = std::time::Instant::now();
    let initial_res = RezkaParser::get_media_details(&state.client, &mirror, &item_url).await;

    let mut details = match initial_res {
        Ok(d) => {
            MirrorManager::record_outcome(&mirror, true, start.elapsed().as_millis() as u64, None);
            d
        }
        Err(e) => {
            MirrorManager::record_outcome(&mirror, false, 0, None);
            if let Some(new_mirror) = failover_to_best_mirror(&state, &mirror).await {
                let retry_start = std::time::Instant::now();
                match RezkaParser::get_media_details(&state.client, &new_mirror, &item_url).await {
                    Ok(d) => {
                        MirrorManager::record_outcome(&new_mirror, true, retry_start.elapsed().as_millis() as u64, None);
                        d
                    }
                    Err(retry_err) => return Err(retry_err.to_string()),
                }
            } else {
                return Err(e.to_string());
            }
        }
    };

    if let Some(ref mut s) = details.initial_streams {
        crate::cdn::CdnSelector::optimize_stream(&state.client, s).await;
    }

    Ok(details)
}

#[tauri::command]
pub async fn get_stream(
    state: State<'_, AppState>,
    media_id: String,
    translator_id: Option<String>,
    season: Option<i32>,
    episode: Option<i32>,
    is_series: bool,
    referer_url: String,
) -> Result<StreamData, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    let start = std::time::Instant::now();
    let initial_res = RezkaParser::get_stream(
        &state.client,
        &mirror,
        &media_id,
        translator_id.as_deref(),
        season,
        episode,
        is_series,
        &referer_url,
    )
    .await;

    let is_bad = match &initial_res {
        Ok(s) => s.qualities.is_empty() && !s.is_premium,
        Err(_) => true,
    };

    let mut stream = if !is_bad {
        MirrorManager::record_outcome(&mirror, true, start.elapsed().as_millis() as u64, Some(true));
        initial_res.map_err(|e| e.to_string())?
    } else {
        // Step A (Session Warmup on current mirror)
        let warmup_details = RezkaParser::get_media_details(&state.client, &mirror, &referer_url).await.ok();
        let retry_start = std::time::Instant::now();
        let step_a_res = RezkaParser::get_stream(
            &state.client,
            &mirror,
            &media_id,
            translator_id.as_deref(),
            season,
            episode,
            is_series,
            &referer_url,
        )
        .await;

        let step_a_bad = match &step_a_res {
            Ok(s) => s.qualities.is_empty() && !s.is_premium,
            Err(_) => true,
        };

        if !step_a_bad {
            MirrorManager::record_outcome(&mirror, true, retry_start.elapsed().as_millis() as u64, Some(true));
            step_a_res.map_err(|e| e.to_string())?
        } else if let Some(fallback) = warmup_details.and_then(|d| d.initial_streams).filter(|s| !s.qualities.is_empty() || s.is_premium) {
            MirrorManager::record_outcome(&mirror, true, retry_start.elapsed().as_millis() as u64, Some(true));
            fallback
        } else {
            // Step B (Zero-Downtime Mirror Failover)
            MirrorManager::record_outcome(&mirror, false, 0, Some(false));
            if let Some(new_mirror) = failover_to_best_mirror(&state, &mirror).await {
                let new_warmup_details = RezkaParser::get_media_details(&state.client, &new_mirror, &referer_url).await.ok();
                let step_b_start = std::time::Instant::now();
                let step_b_res = RezkaParser::get_stream(
                    &state.client,
                    &new_mirror,
                    &media_id,
                    translator_id.as_deref(),
                    season,
                    episode,
                    is_series,
                    &referer_url,
                )
                .await;

                match step_b_res {
                    Ok(s) if !s.qualities.is_empty() || s.is_premium => {
                        MirrorManager::record_outcome(&new_mirror, true, step_b_start.elapsed().as_millis() as u64, Some(true));
                        s
                    }
                    _ => {
                        if let Some(fallback) = new_warmup_details.and_then(|d| d.initial_streams).filter(|s| !s.qualities.is_empty() || s.is_premium) {
                            MirrorManager::record_outcome(&new_mirror, true, step_b_start.elapsed().as_millis() as u64, Some(true));
                            fallback
                        } else {
                            MirrorManager::record_outcome(&new_mirror, false, 0, Some(false));
                            return Err("Потоки відтворення недоступні для обраного перекладу".to_string());
                        }
                    }
                }
            } else {
                return Err(initial_res.err().map(|e| e.to_string()).unwrap_or_else(|| "Потоки недоступні".to_string()));
            }
        }
    };

    crate::cdn::CdnSelector::optimize_stream(&state.client, &mut stream).await;
    Ok(stream)
}

#[tauri::command]
pub async fn get_episodes(
    state: State<'_, AppState>,
    media_id: String,
    translator_id: String,
    referer_url: String,
) -> Result<EpisodesData, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    let start = std::time::Instant::now();
    let initial_res = RezkaParser::get_episodes(
        &state.client,
        &mirror,
        &media_id,
        &translator_id,
        &referer_url,
    )
    .await;

    let (seasons, episodes, mut stream_data) = match initial_res {
        Ok(data) => {
            MirrorManager::record_outcome(&mirror, true, start.elapsed().as_millis() as u64, None);
            data
        }
        Err(e) => {
            MirrorManager::record_outcome(&mirror, false, 0, None);
            if let Some(new_mirror) = failover_to_best_mirror(&state, &mirror).await {
                let retry_start = std::time::Instant::now();
                match RezkaParser::get_episodes(
                    &state.client,
                    &new_mirror,
                    &media_id,
                    &translator_id,
                    &referer_url,
                )
                .await
                {
                    Ok(data) => {
                        MirrorManager::record_outcome(&new_mirror, true, retry_start.elapsed().as_millis() as u64, None);
                        data
                    }
                    Err(retry_err) => return Err(retry_err.to_string()),
                }
            } else {
                return Err(e.to_string());
            }
        }
    };

    if let Some(ref mut s) = stream_data {
        crate::cdn::CdnSelector::optimize_stream(&state.client, s).await;
    }

    Ok(EpisodesData {
        seasons,
        episodes,
        stream_data,
    })
}

#[tauri::command]
pub fn get_turbo_stream_url(state: State<'_, AppState>, raw_url: String) -> String {
    state.turbo.get_turbo_url(&raw_url)
}

#[tauri::command]
pub fn get_turbo_stats(state: State<'_, AppState>) -> crate::turbo::TurboStats {
    state.turbo.get_stats()
}

#[tauri::command]
pub async fn select_fastest_cdn(state: State<'_, AppState>, stream_url: String) -> Result<(String, u64), String> {
    Ok(crate::cdn::CdnSelector::select_fastest_cdn(&state.client, &stream_url).await)
}

// ==================== Window & Player Helper Commands ====================

#[derive(Debug, Clone, Copy)]
struct SavedWindowState {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    is_maximized: bool,
}

static SAVED_WINDOW_STATE: OnceLock<Mutex<Option<SavedWindowState>>> = OnceLock::new();

fn get_saved_window_state() -> &'static Mutex<Option<SavedWindowState>> {
    SAVED_WINDOW_STATE.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub async fn set_mini_player_mode(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    if enabled {
        let is_max = window.is_maximized().unwrap_or(false);
        let size = window.inner_size().unwrap_or_else(|_| PhysicalSize::new(1440, 900));
        let pos = window.outer_position().unwrap_or_else(|_| PhysicalPosition::new(100, 100));

        if let Ok(mut state_guard) = get_saved_window_state().lock() {
            if state_guard.is_none() {
                *state_guard = Some(SavedWindowState {
                    size,
                    position: pos,
                    is_maximized: is_max,
                });
            }
        }

        if is_max {
            let _ = window.unmaximize();
        }

        let _ = window.set_min_size(Some(LogicalSize::new(320.0, 180.0)));
        let _ = window.set_always_on_top(true);
        let _ = window.set_decorations(false);
        let _ = window.set_size(LogicalSize::new(520.0, 292.0));

        #[cfg(target_os = "linux")]
        {
            if std::env::var_os("NIRI_SOCKET").is_some() {
                let _ = std::process::Command::new("niri").args(["msg", "action", "move-window-to-floating"]).status();
                let _ = std::process::Command::new("niri").args(["msg", "action", "set-window-width", "520"]).status();
                let _ = std::process::Command::new("niri").args(["msg", "action", "set-window-height", "292"]).status();
            }
        }
    } else {
        #[cfg(target_os = "linux")]
        {
            if std::env::var_os("NIRI_SOCKET").is_some() {
                let _ = std::process::Command::new("niri").args(["msg", "action", "move-window-to-tiling"]).status();
                let _ = std::process::Command::new("niri").args(["msg", "action", "reset-window-height"]).status();
            }
        }

        let _ = window.set_always_on_top(false);
        let _ = window.set_decorations(true);
        let _ = window.set_min_size(Some(LogicalSize::new(960.0, 600.0)));

        let saved = get_saved_window_state().lock().ok().and_then(|mut g| g.take());
        if let Some(prev) = saved {
            let _ = window.set_size(prev.size);
            let _ = window.set_position(prev.position);
            if prev.is_maximized {
                let _ = window.maximize();
            }
        } else {
            let _ = window.set_size(LogicalSize::new(1440.0, 900.0));
            let _ = window.center();
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn set_fullscreen_mode(app_handle: AppHandle, enabled: bool) -> Result<bool, String> {
    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let _ = window.set_fullscreen(enabled);

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("NIRI_SOCKET").is_some() {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if let (Ok(win_size), Ok(Some(monitor))) = (window.inner_size(), window.current_monitor()) {
                let mon_size = monitor.size();
                let is_currently_full = win_size.width >= mon_size.width.saturating_sub(2)
                    && win_size.height >= mon_size.height.saturating_sub(2);
                if enabled && !is_currently_full {
                    let _ = std::process::Command::new("niri")
                        .args(["msg", "action", "fullscreen-window"])
                        .status();
                } else if !enabled && is_currently_full {
                    let _ = std::process::Command::new("niri")
                        .args(["msg", "action", "fullscreen-window"])
                        .status();
                }
            }
        }
    }

    Ok(enabled)
}

#[tauri::command]
pub async fn start_drag_window(app_handle: AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.start_dragging();
    }
    Ok(())
}

#[tauri::command]
pub async fn open_in_external_player(
    stream_url: String,
    position_sec: Option<f64>,
    title: Option<String>,
) -> Result<(), String> {
    // Try mpv first, then vlc
    let mut mpv_cmd = std::process::Command::new("mpv");
    mpv_cmd.arg(&stream_url);
    mpv_cmd.arg("--ontop");
    if let Some(pos) = position_sec {
        if pos > 0.0 {
            mpv_cmd.arg(format!("--start={}", pos));
        }
    }
    if let Some(t) = title.as_deref() {
        mpv_cmd.arg(format!("--force-media-title={}", t));
    }

    if mpv_cmd.spawn().is_ok() {
        return Ok(());
    }

    let mut vlc_cmd = std::process::Command::new("vlc");
    vlc_cmd.arg(&stream_url);
    if let Some(pos) = position_sec {
        if pos > 0.0 {
            vlc_cmd.arg(format!("--start-time={}", pos as u64));
        }
    }
    if let Some(t) = title.as_deref() {
        vlc_cmd.arg(format!("--meta-title={}", t));
    }

    if vlc_cmd.spawn().is_ok() {
        return Ok(());
    }

    Err("Neither mpv nor vlc could be launched. Please ensure MPV or VLC is installed on your system.".into())
}

// ==================== MPRIS Remote Commands ====================

#[tauri::command]
pub async fn update_mpris_state(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    poster: Option<String>,
    duration_sec: Option<f64>,
    position_sec: Option<f64>,
    is_playing: bool,
) -> Result<(), String> {
    state.mpris.update(&app, title, artist, album, poster, duration_sec, position_sec, is_playing);
    Ok(())
}

#[tauri::command]
pub async fn clear_mpris_state(state: State<'_, AppState>) -> Result<(), String> {
    state.mpris.clear();
    Ok(())
}

// ==================== Audio Commands ====================

#[tauri::command]
pub fn play_startup_sound(volume: Option<f32>) {
    crate::audio::play_startup_sound(volume);
}

#[tauri::command]
pub fn play_ui_sound(sound_type: String) {
    crate::audio::play_ui_sound(&sound_type);
}

// ==================== TMDB Backdrop Commands ====================

#[tauri::command]
pub async fn get_backdrop(
    title: String,
    orig_title: Option<String>,
    year: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    Ok(state.tmdb.get_backdrop(&title, orig_title.as_deref(), year.as_deref()).await)
}


