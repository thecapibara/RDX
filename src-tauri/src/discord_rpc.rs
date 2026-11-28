use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const DEFAULT_DISCORD_CLIENT_ID: &str = "1576167329119735900";
pub const RDX_LOGO_URL: &str =
    "https://raw.githubusercontent.com/thecapibara/RDX/main/public/logo.png";

fn resolve_client_id(client_id: &str) -> &str {
    let trimmed = client_id.trim();
    if trimmed.is_empty() {
        DEFAULT_DISCORD_CLIENT_ID
    } else {
        trimmed
    }
}

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiscordActivityPayload {
    pub title: String,
    pub subtitle: Option<String>,
    pub poster_url: Option<String>,
    pub is_playing: bool,
    pub position_sec: f64,
    pub duration_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordRpcStatus {
    pub enabled: bool,
    pub connected: bool,
    pub has_client_id: bool,
    pub message: String,
}

#[cfg(unix)]
type IpcStream = std::os::unix::net::UnixStream;
#[cfg(windows)]
type IpcStream = std::fs::File;

struct RpcInner {
    stream: Option<IpcStream>,
    active_client_id: String,
    last_sent_key: String,
    last_sent_at: Option<Instant>,
    last_connect_attempt: Option<Instant>,
    nonce_counter: u64,
}

pub struct DiscordRpcState {
    inner: Mutex<RpcInner>,
}

impl DiscordRpcState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(RpcInner {
                stream: None,
                active_client_id: String::new(),
                last_sent_key: String::new(),
                last_sent_at: None,
                last_connect_attempt: None,
                nonce_counter: 0,
            }),
        }
    }

    pub fn status(&self, enabled: bool, client_id: &str) -> DiscordRpcStatus {
        let trimmed = resolve_client_id(client_id);
        let has_client_id = !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit());
        if !enabled {
            return DiscordRpcStatus {
                enabled: false,
                connected: false,
                has_client_id,
                message: "Вимкнено".to_string(),
            };
        }
        if !has_client_id {
            return DiscordRpcStatus {
                enabled: true,
                connected: false,
                has_client_id: false,
                message: "Потрібен Discord Application ID (створіть додаток «RDX» у Discord Developer Portal)".to_string(),
            };
        }

        let mut guard = self.inner.lock().unwrap();
        if guard.stream.is_none() || guard.active_client_id != trimmed {
            Self::try_connect_locked(&mut guard, trimmed);
        }
        let connected = guard.stream.is_some();
        DiscordRpcStatus {
            enabled: true,
            connected,
            has_client_id: true,
            message: if connected {
                "Підключено до Discord".to_string()
            } else {
                "Discord не запущено або IPC недоступний".to_string()
            },
        }
    }

    pub fn update_activity(
        &self,
        enabled: bool,
        client_id: &str,
        payload: &DiscordActivityPayload,
    ) {
        if !enabled {
            self.clear_activity();
            return;
        }
        let trimmed = resolve_client_id(client_id);
        if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_digit()) {
            return;
        }

        let mut guard = self.inner.lock().unwrap();

        // Rate-limit identical updates (e.g. during smooth playback) to avoid spamming Discord IPC
        let pos_bucket = (payload.position_sec / 5.0).floor() as i64;
        let state_key = format!(
            "{}|{}|{}|{}",
            payload.title,
            payload.subtitle.as_deref().unwrap_or(""),
            payload.is_playing,
            if payload.is_playing { pos_bucket } else { -1 }
        );
        if guard.last_sent_key == state_key {
            if let Some(ts) = guard.last_sent_at {
                if ts.elapsed() < Duration::from_secs(12) {
                    return;
                }
            }
        }

        if guard.stream.is_none() || guard.active_client_id != trimmed {
            if let Some(prev_attempt) = guard.last_connect_attempt {
                if prev_attempt.elapsed() < Duration::from_secs(8) && guard.active_client_id == trimmed {
                    return;
                }
            }
            if !Self::try_connect_locked(&mut guard, trimmed) {
                return;
            }
        }

        guard.nonce_counter += 1;
        let nonce = format!("rdx-{}", guard.nonce_counter);
        let pid = std::process::id();

        let state_text = match (&payload.subtitle, payload.is_playing) {
            (Some(sub), true) if !sub.trim().is_empty() => sub.clone(),
            (Some(sub), false) if !sub.trim().is_empty() => format!("Пауза • {}", sub),
            (_, true) => "Дивиться в RDX".to_string(),
            (_, false) => "На паузі".to_string(),
        };

        let large_image = payload
            .poster_url
            .as_deref()
            .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
            .unwrap_or(RDX_LOGO_URL);

        let mut activity = json!({
            "type": 3, // Watching
            "details": truncate_discord(&payload.title, 120),
            "state": truncate_discord(&state_text, 120),
            "assets": {
                "large_image": large_image,
                "large_text": truncate_discord(&payload.title, 120),
                "small_image": RDX_LOGO_URL,
                "small_text": "RDX Cinema",
            }
        });

        if payload.is_playing && payload.duration_sec > 5.0 {
            let now_secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let start_ts = (now_secs - payload.position_sec.max(0.0) as i64).max(0);
            let remaining = (payload.duration_sec - payload.position_sec).max(0.0) as i64;
            let end_ts = now_secs + remaining;
            activity["timestamps"] = json!({
                "start": start_ts,
                "end": end_ts,
            });
        }

        let frame = json!({
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": pid,
                "activity": activity,
            },
            "nonce": nonce,
        });

        if Self::send_frame_locked(&mut guard, OP_FRAME, &frame).is_ok() {
            guard.last_sent_key = state_key;
            guard.last_sent_at = Some(Instant::now());
        } else {
            guard.stream = None;
        }
    }

    pub fn clear_activity(&self) {
        let mut guard = self.inner.lock().unwrap();
        guard.last_sent_key.clear();
        guard.last_sent_at = None;
        if guard.stream.is_some() {
            guard.nonce_counter += 1;
            let frame = json!({
                "cmd": "SET_ACTIVITY",
                "args": {
                    "pid": std::process::id(),
                    "activity": serde_json::Value::Null,
                },
                "nonce": format!("rdx-clear-{}", guard.nonce_counter),
            });
            let _ = Self::send_frame_locked(&mut guard, OP_FRAME, &frame);
        }
    }

    pub fn disconnect(&self) {
        self.clear_activity();
        let mut guard = self.inner.lock().unwrap();
        if guard.stream.is_some() {
            let _ = Self::send_frame_locked(&mut guard, OP_CLOSE, &json!({}));
        }
        guard.stream = None;
        guard.active_client_id.clear();
    }

    fn try_connect_locked(guard: &mut RpcInner, client_id: &str) -> bool {
        guard.last_connect_attempt = Some(Instant::now());
        guard.stream = None;

        let Some(mut stream) = open_discord_ipc() else {
            return false;
        };

        let handshake = json!({
            "v": 1,
            "client_id": client_id,
        });

        if write_packet(&mut stream, OP_HANDSHAKE, &handshake).is_err() {
            return false;
        }
        // Read Discord READY response (non-fatal if empty, closes on invalid client_id)
        if let Ok((op, _body)) = read_packet(&mut stream) {
            if op == OP_CLOSE {
                return false;
            }
        } else {
            return false;
        }

        guard.stream = Some(stream);
        guard.active_client_id = client_id.to_string();
        true
    }

    fn send_frame_locked(
        guard: &mut RpcInner,
        op: u32,
        payload: &serde_json::Value,
    ) -> std::io::Result<()> {
        let stream = guard
            .stream
            .as_mut()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotConnected, "not connected"))?;
        write_packet(stream, op, payload)?;
        // Drain ACK packet so the pipe buffer never fills up
        let _ = read_packet(stream);
        Ok(())
    }
}

fn truncate_discord(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max_chars {
        trimmed.to_string()
    } else {
        let mut out: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

fn write_packet<W: Write>(w: &mut W, op: u32, payload: &serde_json::Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(payload)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let mut header = [0u8; 8];
    header[..4].copy_from_slice(&op.to_le_bytes());
    header[4..8].copy_from_slice(&(bytes.len() as u32).to_le_bytes());
    w.write_all(&header)?;
    w.write_all(&bytes)?;
    w.flush()
}

fn read_packet<R: Read>(r: &mut R) -> std::io::Result<(u32, Vec<u8>)> {
    let mut header = [0u8; 8];
    r.read_exact(&mut header)?;
    let op = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if len > 65536 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Discord IPC frame too large",
        ));
    }
    let mut body = vec![0u8; len];
    if len > 0 {
        r.read_exact(&mut body)?;
    }
    Ok((op, body))
}

#[cfg(unix)]
fn open_discord_ipc() -> Option<IpcStream> {
    let mut dirs: Vec<String> = Vec::new();
    for env_key in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
        if let Ok(val) = std::env::var(env_key) {
            if !val.trim().is_empty() {
                dirs.push(val);
            }
        }
    }
    dirs.push("/tmp".to_string());

    let subpaths = [
        "",
        "app/com.discordapp.Discord",
        "snap.discord",
        "snap.discord-canary",
    ];

    for dir in &dirs {
        let base = dir.trim_end_matches('/');
        for sub in &subpaths {
            for idx in 0..10 {
                let path = if sub.is_empty() {
                    format!("{}/discord-ipc-{}", base, idx)
                } else {
                    format!("{}/{}/discord-ipc-{}", base, sub, idx)
                };
                if let Ok(stream) = std::os::unix::net::UnixStream::connect(&path) {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
                    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
                    return Some(stream);
                }
            }
        }
    }
    None
}

#[cfg(windows)]
fn open_discord_ipc() -> Option<IpcStream> {
    use std::fs::OpenOptions;
    for idx in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{}", idx);
        if let Ok(file) = OpenOptions::new().read(true).write(true).open(&path) {
            return Some(file);
        }
    }
    None
}
