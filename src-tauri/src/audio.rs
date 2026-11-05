use rodio::{Decoder, OutputStream, Sink};
use std::io::Cursor;

// Embed the startup chime directly into the compiled Rust binary (73 KB)
const STARTUP_CHIME_BYTES: &[u8] = include_bytes!("../../public/startup.mp3");

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
