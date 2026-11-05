use std::sync::Mutex;
use std::time::{Duration, Instant};
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
struct CachedMprisData {
    title: String,
    artist: Option<String>,
    album: Option<String>,
    poster: Option<String>,
    duration_sec: Option<f64>,
    position_sec: Option<f64>,
    is_playing: bool,
    last_position_update: Option<Instant>,
}

pub struct MprisState {
    controls: Mutex<Option<MediaControls>>,
    cached: Mutex<CachedMprisData>,
}

impl MprisState {
    pub fn new() -> Self {
        Self {
            controls: Mutex::new(None),
            cached: Mutex::new(CachedMprisData::default()),
        }
    }

    pub fn init(&self, app: &AppHandle) {
        let mut guard = self.controls.lock().unwrap();
        if guard.is_some() {
            return;
        }

        let config = PlatformConfig {
            dbus_name: "rdx",
            display_name: "RDX",
            hwnd: None,
        };

        let mut controls = match MediaControls::new(config) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Warning: failed to create MediaControls: {:?}", e);
                return;
            }
        };

        let handle = app.clone();
        let attach_res = controls.attach(move |event| {
            match event {
                MediaControlEvent::Play => {
                    let _ = handle.emit("mpris-action", "play");
                }
                MediaControlEvent::Pause => {
                    let _ = handle.emit("mpris-action", "pause");
                }
                MediaControlEvent::Toggle => {
                    let _ = handle.emit("mpris-action", "toggle");
                }
                MediaControlEvent::Stop => {
                    let _ = handle.emit("mpris-action", "pause");
                }
                MediaControlEvent::Next => {
                    let _ = handle.emit("mpris-action", "next");
                }
                MediaControlEvent::Previous => {
                    let _ = handle.emit("mpris-action", "prev");
                }
                MediaControlEvent::Seek(dir) => {
                    let sign = match dir {
                        SeekDirection::Backward => -1.0,
                        SeekDirection::Forward => 1.0,
                    };
                    let _ = handle.emit("mpris-seek", 10.0 * sign);
                }
                MediaControlEvent::SeekBy(dir, delta) => {
                    let sign = match dir {
                        SeekDirection::Backward => -1.0,
                        SeekDirection::Forward => 1.0,
                    };
                    let _ = handle.emit("mpris-seek", delta.as_secs_f64() * sign);
                }
                MediaControlEvent::SetPosition(pos) => {
                    let _ = handle.emit("mpris-set-position", pos.0.as_secs_f64());
                }
                _ => {}
            }
        });

        if let Err(e) = attach_res {
            eprintln!("Warning: failed to attach MediaControls to D-Bus: {:?}", e);
            return;
        }

        let _ = controls.set_playback(MediaPlayback::Stopped);
        *guard = Some(controls);
    }

    pub fn update(
        &self,
        app: &AppHandle,
        title: String,
        artist: Option<String>,
        album: Option<String>,
        poster: Option<String>,
        duration_sec: Option<f64>,
        position_sec: Option<f64>,
        is_playing: bool,
    ) {
        let mut guard = self.controls.lock().unwrap();

        if guard.is_none() {
            drop(guard);
            self.init(app);
            guard = self.controls.lock().unwrap();
        }

        if let Some(controls) = guard.as_mut() {
            let mut cached = self.cached.lock().unwrap();

            // 1. Only emit PropertiesChanged for Metadata if title, artist, album, poster, or duration changed
            let metadata_changed = cached.title != title
                || cached.artist != artist
                || cached.album != album
                || cached.poster != poster
                || cached.duration_sec != duration_sec;

            if metadata_changed {
                let metadata = MediaMetadata {
                    title: Some(&title),
                    artist: artist.as_deref(),
                    album: album.as_deref(),
                    cover_url: poster.as_deref(),
                    duration: duration_sec.filter(|&d| d > 0.0).map(Duration::from_secs_f64),
                };
                let _ = controls.set_metadata(metadata);
            }

            // 2. Only emit PropertiesChanged for PlaybackStatus/Position if play state changed,
            // or position jumped (seek > 1.5s), or >= 1.5s elapsed since last sync.
            // This prevents flooding D-Bus 4 times a second which interrupts GNOME/KDE seekbars!
            let status_changed = cached.is_playing != is_playing;
            let pos_jump = match (cached.position_sec, position_sec) {
                (Some(old), Some(new)) => (new - old).abs() > 1.5,
                (None, Some(_)) => true,
                _ => false,
            };
            let time_elapsed = cached
                .last_position_update
                .map(|t| t.elapsed() >= Duration::from_secs_f64(1.5))
                .unwrap_or(true);

            if status_changed || pos_jump || time_elapsed || metadata_changed {
                let pos = position_sec.map(|p| MediaPosition(Duration::from_secs_f64(p.max(0.0))));
                let playback = if is_playing {
                    MediaPlayback::Playing { progress: pos }
                } else {
                    MediaPlayback::Paused { progress: pos }
                };
                let _ = controls.set_playback(playback);
                cached.last_position_update = Some(Instant::now());
            }

            // Update cached state
            cached.title = title;
            cached.artist = artist;
            cached.album = album;
            cached.poster = poster;
            cached.duration_sec = duration_sec;
            cached.position_sec = position_sec;
            cached.is_playing = is_playing;
        }
    }

    pub fn clear(&self) {
        let mut guard = self.controls.lock().unwrap();
        if let Some(mut controls) = guard.take() {
            let _ = controls.set_playback(MediaPlayback::Stopped);
            let _ = controls.set_metadata(MediaMetadata::default());
            // Drop controls immediately so D-Bus unregisters `org.mpris.MediaPlayer2.rdx`.
            // This causes GNOME / KDE / Waybar to remove the player widget from the top bar in 0.01s
            // instead of waiting for a 15-20s inactivity timeout.
            drop(controls);
        }
        let mut cached = self.cached.lock().unwrap();
        *cached = CachedMprisData::default();
    }
}
