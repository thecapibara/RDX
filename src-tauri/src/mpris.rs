use std::sync::Mutex;
use std::time::Duration;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use tauri::{AppHandle, Emitter};

pub struct MprisState {
    controls: Mutex<Option<MediaControls>>,
}

impl MprisState {
    pub fn new() -> Self {
        Self {
            controls: Mutex::new(None),
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
                MediaControlEvent::Next => {
                    let _ = handle.emit("mpris-action", "next");
                }
                MediaControlEvent::Previous => {
                    let _ = handle.emit("mpris-action", "prev");
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
            let metadata = MediaMetadata {
                title: Some(&title),
                artist: artist.as_deref(),
                album: album.as_deref(),
                cover_url: poster.as_deref(),
                duration: duration_sec.filter(|&d| d > 0.0).map(Duration::from_secs_f64),
            };
            let _ = controls.set_metadata(metadata);

            let pos = position_sec.map(|p| MediaPosition(Duration::from_secs_f64(p.max(0.0))));
            let playback = if is_playing {
                MediaPlayback::Playing { progress: pos }
            } else {
                MediaPlayback::Paused { progress: pos }
            };
            let _ = controls.set_playback(playback);
        }
    }

    pub fn clear(&self) {
        let mut guard = self.controls.lock().unwrap();
        if let Some(controls) = guard.as_mut() {
            let _ = controls.set_metadata(MediaMetadata::default());
            let _ = controls.set_playback(MediaPlayback::Stopped);
        }
    }
}
