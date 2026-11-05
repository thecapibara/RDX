use std::sync::Arc;
use tauri::{AppHandle, LogicalSize, Manager, State, WebviewUrl, WebviewWindowBuilder};
use serde::{Deserialize, Serialize};

use crate::client::HttpClient;
use crate::mirror::{MirrorManager, MirrorStatus, SmartRotationResult, PRESET_MIRRORS};
use crate::parser::{
    EpisodeTab, MediaCard, MediaDetails, RezkaParser, SearchItem, SeasonTab, StreamData,
};
use crate::storage::{AppSettings, Bookmark, Storage, WatchProgress};

pub struct AppState {
    pub storage: Arc<Storage>,
    pub client: Arc<HttpClient>,
    pub mpris: Arc<crate::mpris::MprisState>,
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
    RezkaParser::get_media_details(&state.client, &mirror, &item_url)
        .await
        .map_err(|e| e.to_string())
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
    RezkaParser::get_stream(
        &state.client,
        &mirror,
        &media_id,
        translator_id.as_deref(),
        season,
        episode,
        is_series,
        &referer_url,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_episodes(
    state: State<'_, AppState>,
    media_id: String,
    translator_id: String,
    referer_url: String,
) -> Result<EpisodesData, String> {
    let mirror = state.storage.get_settings().map_err(|e| e.to_string())?.active_mirror;
    let (seasons, episodes, stream_data) = RezkaParser::get_episodes(
        &state.client,
        &mirror,
        &media_id,
        &translator_id,
        &referer_url,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(EpisodesData {
        seasons,
        episodes,
        stream_data,
    })
}

// ==================== Window & Player Helper Commands ====================

#[tauri::command]
pub async fn set_mini_player_mode(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    if enabled {
        let _ = window.set_min_size(Some(LogicalSize::new(320.0, 180.0)));
        let _ = window.set_always_on_top(true);
        let _ = window.set_decorations(false);
        let _ = window.set_size(LogicalSize::new(520.0, 292.0));

        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("niri").args(["msg", "action", "move-window-to-floating"]).status();
            let _ = std::process::Command::new("niri").args(["msg", "action", "set-window-width", "520"]).status();
            let _ = std::process::Command::new("niri").args(["msg", "action", "set-window-height", "292"]).status();
        }
    } else {
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("niri").args(["msg", "action", "move-window-to-tiling"]).status();
            let _ = std::process::Command::new("niri").args(["msg", "action", "reset-window-height"]).status();
        }

        let _ = window.set_always_on_top(false);
        let _ = window.set_decorations(true);
        let _ = window.set_min_size(Some(LogicalSize::new(960.0, 600.0)));
        let _ = window.set_size(LogicalSize::new(1440.0, 900.0));
        let _ = window.center();
    }

    Ok(())
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

