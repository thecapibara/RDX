pub mod client;
pub mod commands;
pub mod mirror;
pub mod parser;
pub mod storage;

use std::sync::Arc;
use client::{default_cookie_path, HttpClient, PersistentCookieStore};
use commands::AppState;
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

    let state = AppState { storage, client };

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        use webkit2gtk::glib::translate::ToGlibPtr;
                        use webkit2gtk::{SettingsExt, WebViewExt};
                        let wk = webview.inner();
                        if let Some(settings) = wk.settings() {
                            settings.set_enable_smooth_scrolling(true);
                            settings.set_enable_page_cache(true);

                            // Disable WebKit's internal MPRIS/MediaSession to prevent ghost player cards on Linux D-Bus
                            unsafe {
                                let raw: *mut webkit2gtk::ffi::WebKitSettings = settings.to_glib_none().0;
                                disable_webkit_media_session(raw as *mut std::ffi::c_void);
                            }
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
            commands::start_drag_window,
            commands::open_in_external_player,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "linux")]
unsafe fn disable_webkit_media_session(raw_settings: *mut std::ffi::c_void) {
    extern "C" {
        fn webkit_settings_get_all_features() -> *mut std::ffi::c_void;
        fn webkit_feature_list_find(
            feature_list: *mut std::ffi::c_void,
            identifier: *const std::ffi::c_char,
        ) -> *mut std::ffi::c_void;
        fn webkit_settings_set_feature_enabled(
            settings: *mut std::ffi::c_void,
            feature: *mut std::ffi::c_void,
            enabled: i32,
        );
        fn webkit_feature_list_unref(feature_list: *mut std::ffi::c_void);
    }

    let features = webkit_settings_get_all_features();
    if !features.is_null() {
        if let Ok(c_name) = std::ffi::CString::new("MediaSession") {
            let feature = webkit_feature_list_find(features, c_name.as_ptr());
            if !feature.is_null() {
                webkit_settings_set_feature_enabled(raw_settings, feature, 0);
            }
        }
        webkit_feature_list_unref(features);
    }
}
