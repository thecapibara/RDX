use rodio::{buffer::SamplesBuffer, Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use std::io::Cursor;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

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

struct PredecodedSound {
    samples: Arc<[f32]>,
    channels: u16,
    sample_rate: u32,
}

fn decode_sound(bytes: &'static [u8]) -> Option<PredecodedSound> {
    let source = Decoder::new(Cursor::new(bytes)).ok()?;
    let channels = source.channels();
    let sample_rate = source.sample_rate();
    let samples: Vec<f32> = source.convert_samples::<f32>().collect();
    Some(PredecodedSound {
        samples: Arc::from(samples),
        channels,
        sample_rate,
    })
}

static UI_AUDIO_TX: OnceLock<Sender<UiSoundType>> = OnceLock::new();

fn get_or_init_ui_audio_tx() -> &'static Sender<UiSoundType> {
    UI_AUDIO_TX.get_or_init(|| {
        let (tx, rx) = channel::<UiSoundType>();
        std::thread::spawn(move || {
            let hover_sound = decode_sound(HOVERCARD_SOUND_BYTES);
            let modal_sound = decode_sound(OPENCARD_SOUND_BYTES);
            let click_sound = decode_sound(BUTTONCLICK_SOUND_BYTES);

            let mut active_stream: Option<(OutputStream, OutputStreamHandle)> = None;
            let mut last_hover_time = Instant::now() - Duration::from_secs(1);

            loop {
                match rx.recv_timeout(Duration::from_secs(10)) {
                    Ok(sound_type) => {
                        if let UiSoundType::Hover = sound_type {
                            if last_hover_time.elapsed() < Duration::from_millis(35) {
                                continue;
                            }
                            last_hover_time = Instant::now();
                        }

                        if active_stream.is_none() {
                            match OutputStream::try_default() {
                                Ok(pair) => active_stream = Some(pair),
                                Err(_) => {
                                    eprintln!("RDX Audio: failed to acquire default audio stream for UI feedback sounds");
                                    continue;
                                }
                            }
                        }

                        let Some((_, stream_handle)) = active_stream.as_ref() else {
                            continue;
                        };

                        let Ok(sink) = Sink::try_new(stream_handle) else {
                            continue;
                        };

                        let (volume, predecoded) = match sound_type {
                            UiSoundType::Hover => (0.50, hover_sound.as_ref()),
                            UiSoundType::ModalOpen => (0.60, modal_sound.as_ref()),
                            UiSoundType::ButtonClick => (0.55, click_sound.as_ref()),
                        };

                        if let Some(sound) = predecoded {
                            sink.set_volume(volume);
                            sink.append(SamplesBuffer::new(
                                sound.channels,
                                sound.sample_rate,
                                sound.samples.to_vec(),
                            ));
                            sink.detach();
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        // Drop stream after 10s of silence so PipeWire/ALSA suspends cleanly
                        active_stream = None;
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
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
