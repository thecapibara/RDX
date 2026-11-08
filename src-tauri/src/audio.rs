use rodio::{source::Zero, Decoder, OutputStream, Sink};
use std::io::Cursor;
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

// Embedded sound assets (compiled directly into the binary)
const STARTUP_CHIME_BYTES: &[u8] = include_bytes!("../../public/startup.mp3");
const HOVERCARD_SOUND_BYTES: &[u8] = include_bytes!("../../public/hovercard.mp3");
const OPENCARD_SOUND_BYTES: &[u8] = include_bytes!("../../public/opencard.mp3");
const BUTTONCLICK_SOUND_BYTES: &[u8] = include_bytes!("../../public/buttonclick.mp3");

#[derive(Clone, Copy, Debug)]
pub enum UiSoundType {
    Hover,
    ModalOpen,
    ButtonClick,
}

static UI_AUDIO_TX: OnceLock<Sender<UiSoundType>> = OnceLock::new();

fn get_or_init_ui_audio_tx() -> &'static Sender<UiSoundType> {
    UI_AUDIO_TX.get_or_init(|| {
        let (tx, rx) = channel::<UiSoundType>();
        std::thread::spawn(move || {
            let Ok((_stream, stream_handle)) = OutputStream::try_default() else {
                eprintln!("RDX Audio: failed to acquire default audio stream for UI feedback sounds");
                return;
            };

            // Keep PipeWire/ALSA/WASAPI audio stream active to prevent DAC sleep & truncated transients
            if let Ok(keepalive_sink) = Sink::try_new(&stream_handle) {
                keepalive_sink.set_volume(0.0);
                keepalive_sink.append(Zero::<f32>::new(2, 44100));
                keepalive_sink.detach();
            }

            let mut last_hover_time = std::time::Instant::now() - std::time::Duration::from_secs(1);

            while let Ok(sound_type) = rx.recv() {
                if let UiSoundType::Hover = sound_type {
                    if last_hover_time.elapsed() < std::time::Duration::from_millis(35) {
                        continue;
                    }
                    last_hover_time = std::time::Instant::now();
                }

                let Ok(sink) = Sink::try_new(&stream_handle) else {
                    continue;
                };
                match sound_type {
                    UiSoundType::Hover => {
                        sink.set_volume(0.50);
                        if let Ok(source) = Decoder::new(Cursor::new(HOVERCARD_SOUND_BYTES)) {
                            sink.append(source);
                            sink.detach();
                        }
                    }
                    UiSoundType::ModalOpen => {
                        sink.set_volume(0.60);
                        if let Ok(source) = Decoder::new(Cursor::new(OPENCARD_SOUND_BYTES)) {
                            sink.append(source);
                            sink.detach();
                        }
                    }
                    UiSoundType::ButtonClick => {
                        sink.set_volume(0.55);
                        if let Ok(source) = Decoder::new(Cursor::new(BUTTONCLICK_SOUND_BYTES)) {
                            sink.append(source);
                            sink.detach();
                        }
                    }
                }
            }
        });
        tx
    })
}

/// Dispatch a UI feedback sound to the dedicated background audio thread
pub fn play_ui_sound(sound_type: &str) {
    let sound = match sound_type {
        "hover" => UiSoundType::Hover,
        "modal_open" => UiSoundType::ModalOpen,
        "button_click" => UiSoundType::ButtonClick,
        _ => return,
    };
    let tx = get_or_init_ui_audio_tx();
    let _ = tx.send(sound);
}

/// Play startup sound in a detached background thread at specified volume (0.0 to 1.0)
pub fn play_startup_sound(volume: Option<f32>) {
    let vol = volume.unwrap_or(0.55).clamp(0.0, 1.0);
    std::thread::spawn(move || {
        let Ok((_stream, stream_handle)) = OutputStream::try_default() else {
            eprintln!("RDX Audio: failed to acquire default audio output stream (ALSA/Pulse/PipeWire)");
            return;
        };
        let Ok(sink) = Sink::try_new(&stream_handle) else {
            eprintln!("RDX Audio: failed to create audio sink");
            return;
        };
        sink.set_volume(vol);

        let cursor = Cursor::new(STARTUP_CHIME_BYTES);
        match Decoder::new(cursor) {
            Ok(source) => {
                sink.append(source);
                sink.sleep_until_end();
            }
            Err(e) => {
                eprintln!("RDX Audio: failed to decode embedded startup mp3: {e}");
            }
        }
    });
}
