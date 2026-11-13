pub mod audio;
pub mod cdn;
pub mod client;
pub mod commands;
pub mod downloader;
pub mod mirror;
pub mod mpris;
pub mod parser;
pub mod storage;
pub mod tmdb;
pub mod turbo;

use std::sync::Arc;
use client::{default_cookie_path, HttpClient, PersistentCookieStore};
use commands::AppState;
use mpris::MprisState;
use storage::{default_db_path, Storage};

pub fn run() {
    let db_path = default_db_path();
    let storage = Arc::new(Storage::new(&db_path).unwrap_or_else(|e| {
        eprintln!("Warning: failed to open SQLite at {:?}: {}. Using in-memory.", db_path, e);
        Storage::in_memory().expect("in-memory db fallback")
    }));

    let cookie_path = default_cookie_path();
    let cookie_store = Arc::new(PersistentCookieStore::new(Some(&cookie_path)));

    let proxy_url = storage
        .get_settings()
        .ok()
        .map(|s| s.proxy_url)
        .filter(|p| !p.trim().is_empty());

    let client = Arc::new(
        HttpClient::new(cookie_store, proxy_url.as_deref())
            .expect("failed to initialize HTTP client"),
    );

    let mpris = Arc::new(MprisState::new());
    let downloader = Arc::new(downloader::DownloadManager::new(storage.clone()));
    let turbo = Arc::new(turbo::TurboServer::new(client.get_reqwest_client()));
    let tmdb = Arc::new(tmdb::TmdbService::new());
    let turbo_spawn = turbo.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = turbo_spawn.start().await {
            eprintln!("[RDX Turbo] Server start warning: {}", e);
        }
    });

    let state = AppState { storage, client, mpris, downloader, turbo, tmdb };

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .setup(|app| {
            use tauri::Manager;

            // 1. Initialize native Rust MPRIS while DBUS_SESSION_BUS_ADDRESS is valid
            let state: tauri::State<AppState> = app.state();
            state.mpris.init(&app.handle());

            // 2. Play instant boot chime if enabled (native PipeWire/PulseAudio/ALSA)
            let startup_sound_enabled = state
                .storage
                .get_settings()
                .map(|s| s.startup_sound)
                .unwrap_or(true);

            if startup_sound_enabled {
                crate::audio::play_startup_sound(Some(0.55));
            }

            #[cfg(target_os = "linux")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        use webkit2gtk::{SettingsExt, WebViewExt};
                        let wk = webview.inner();
                        if let Some(settings) = wk.settings() {
                            settings.set_enable_smooth_scrolling(true);
                            settings.set_enable_page_cache(true);
                            settings.set_media_playback_requires_user_gesture(false);
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::save_watch_progress,
            commands::get_watch_progress,
            commands::get_continue_watching,
            commands::delete_watch_progress,
            commands::get_episode_progress,
            commands::start_download,
            commands::pause_download,
            commands::resume_download,
            commands::cancel_download,
            commands::delete_download,
            commands::get_downloads,
            commands::get_downloads_dir,
            commands::pause_all_downloads,
            commands::resume_all_downloads,
            commands::clear_completed_downloads,
            commands::show_in_folder,
            commands::open_url,
            commands::restart_app,
            commands::toggle_bookmark,
            commands::get_bookmarks,
            commands::is_bookmarked,
            commands::check_mirror_status,
            commands::check_all_mirrors,
            commands::smart_select_mirror,
            commands::get_active_mirror,
            commands::set_active_mirror,
            commands::open_captcha_window,
            commands::get_home_catalog,
            commands::get_category_catalog,
            commands::search_media,
            commands::search_autocomplete,
            commands::get_media_details,
            commands::get_stream,
            commands::get_episodes,
            commands::set_mini_player_mode,
            commands::set_fullscreen_mode,
            commands::start_drag_window,
            commands::open_in_external_player,
            commands::update_mpris_state,
            commands::clear_mpris_state,
            commands::play_startup_sound,
            commands::play_ui_sound,
            commands::get_turbo_stream_url,
            commands::get_turbo_stats,
            commands::select_fastest_cdn,
            commands::get_backdrop,
            commands::get_system_time,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


