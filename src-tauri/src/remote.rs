use qrcode::render::svg;
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, TcpListener as StdTcpListener, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const DEFAULT_REMOTE_PORT: u16 = 17420;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RemotePlaybackState {
    pub active: bool,
    pub title: String,
    pub subtitle: String,
    pub is_series: bool,
    pub is_playing: bool,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub volume: f64,
    pub muted: bool,
    pub audio_preset: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteCommandEvent {
    pub action: String,
    pub value: Option<f64>,
    pub str_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteServerInfo {
    pub running: bool,
    pub url: String,
    pub qr_svg: String,
    pub port: u16,
}

struct RunningServer {
    port: u16,
    url: String,
    qr_svg: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

pub struct RemoteControlState {
    server: Mutex<Option<RunningServer>>,
    playback: Arc<Mutex<RemotePlaybackState>>,
}

impl RemoteControlState {
    pub fn new() -> Self {
        Self {
            server: Mutex::new(None),
            playback: Arc::new(Mutex::new(RemotePlaybackState::default())),
        }
    }

    pub fn update_playback(&self, state: RemotePlaybackState) {
        if let Ok(mut guard) = self.playback.lock() {
            *guard = state;
        }
    }

    pub fn clear_playback(&self) {
        if let Ok(mut guard) = self.playback.lock() {
            *guard = RemotePlaybackState::default();
        }
    }

    pub fn info(&self) -> RemoteServerInfo {
        let guard = self.server.lock().unwrap();
        if let Some(ref srv) = *guard {
            RemoteServerInfo {
                running: true,
                url: srv.url.clone(),
                qr_svg: srv.qr_svg.clone(),
                port: srv.port,
            }
        } else {
            RemoteServerInfo {
                running: false,
                url: String::new(),
                qr_svg: String::new(),
                port: 0,
            }
        }
    }

    pub fn start(&self, app_handle: AppHandle) -> Result<RemoteServerInfo, String> {
        {
            let guard = self.server.lock().unwrap();
            if let Some(ref srv) = *guard {
                return Ok(RemoteServerInfo {
                    running: true,
                    url: srv.url.clone(),
                    qr_svg: srv.qr_svg.clone(),
                    port: srv.port,
                });
            }
        }

        let std_listener = StdTcpListener::bind(("0.0.0.0", DEFAULT_REMOTE_PORT))
            .or_else(|_| StdTcpListener::bind(("0.0.0.0", 0)))
            .map_err(|e| format!("Не вдалося запустити Wi-Fi пульт: {}", e))?;
        std_listener
            .set_nonblocking(true)
            .map_err(|e| e.to_string())?;
        let port = std_listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .port();

        let lan_ip = detect_lan_ipv4().unwrap_or_else(|| "127.0.0.1".to_string());
        let url = format!("http://{}:{}", lan_ip, port);
        let qr_svg = generate_qr_svg(&url);

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        let playback_arc = self.playback.clone();

        tauri::async_runtime::spawn(async move {
            let Ok(listener) = TcpListener::from_std(std_listener) else {
                return;
            };
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        break;
                    }
                    accepted = listener.accept() => {
                        if let Ok((socket, _)) = accepted {
                            let _ = socket.set_nodelay(true);
                            let pb = playback_arc.clone();
                            let ah = app_handle.clone();
                            tokio::spawn(async move {
                                let _ = handle_remote_conn(socket, pb, ah).await;
                            });
                        }
                    }
                }
            }
        });

        let info = RemoteServerInfo {
            running: true,
            url: url.clone(),
            qr_svg: qr_svg.clone(),
            port,
        };

        let mut guard = self.server.lock().unwrap();
        *guard = Some(RunningServer {
            port,
            url,
            qr_svg,
            shutdown_tx: Some(shutdown_tx),
        });

        Ok(info)
    }

    pub fn stop(&self) -> RemoteServerInfo {
        let mut guard = self.server.lock().unwrap();
        if let Some(mut srv) = guard.take() {
            if let Some(tx) = srv.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
        RemoteServerInfo {
            running: false,
            url: String::new(),
            qr_svg: String::new(),
            port: 0,
        }
    }
}

fn detect_lan_ipv4() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() => Some(v4.to_string()),
        _ => None,
    }
}

fn generate_qr_svg(url: &str) -> String {
    match QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(180, 180)
            .quiet_zone(true)
            .dark_color(svg::Color("#09090b"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

async fn handle_remote_conn(
    mut socket: TcpStream,
    playback: Arc<Mutex<RemotePlaybackState>>,
    app_handle: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = vec![0u8; 8192];
    let mut filled = 0usize;
    let header_end;

    loop {
        if filled >= buf.len() {
            return Ok(());
        }
        let n = tokio::time::timeout(Duration::from_secs(5), socket.read(&mut buf[filled..])).await??;
        if n == 0 {
            return Ok(());
        }
        filled += n;
        if let Some(pos) = buf[..filled].windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
    }

    let h_end = header_end;
    let header_str = String::from_utf8_lossy(&buf[..h_end]);
    let mut lines = header_str.lines();
    let first_line = lines.next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let path = parts.next().unwrap_or("/");

    let mut content_length: usize = 0;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = buf[h_end..filled].to_vec();
    while body.len() < content_length && body.len() < 8192 {
        let mut chunk = [0u8; 1024];
        let n = tokio::time::timeout(Duration::from_secs(3), socket.read(&mut chunk)).await??;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }

    if method == "OPTIONS" {
        socket
            .write_all(b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }

    if method == "GET" && (path == "/" || path.starts_with("/?")) {
        let html_bytes = REMOTE_WEB_UI_HTML.as_bytes();
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
            html_bytes.len()
        );
        socket.write_all(resp.as_bytes()).await?;
        socket.write_all(html_bytes).await?;
        return Ok(());
    }

    if method == "GET" && path == "/api/state" {
        let state_snapshot = playback.lock().map(|g| g.clone()).unwrap_or_default();
        let json_bytes = serde_json::to_vec(&state_snapshot).unwrap_or_else(|_| b"{}".to_vec());
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
            json_bytes.len()
        );
        socket.write_all(resp.as_bytes()).await?;
        socket.write_all(&json_bytes).await?;
        return Ok(());
    }

    if method == "POST" && path == "/api/cmd" {
        if let Ok(cmd) = serde_json::from_slice::<RemoteCommandEvent>(&body) {
            let _ = app_handle.emit("remote://command", cmd);
        }
        let ok_body = b"{\"ok\":true}";
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            ok_body.len()
        );
        socket.write_all(resp.as_bytes()).await?;
        socket.write_all(ok_body).await?;
        return Ok(());
    }

    socket
        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found")
        .await?;
    Ok(())
}

const REMOTE_WEB_UI_HTML: &str = r##"<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>RDX Пульт</title>
<style>
  :root{--bg:#09090b;--card:#141418;--border:rgba(255,255,255,.1);--accent:#e11d48;--text:#fafafa;--muted:#a1a1aa}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none}
  body{margin:0;min-height:100dvh;background:radial-gradient(circle at top,rgba(225,29,72,.18),transparent 52%),var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;padding:18px 16px 28px}
  .wrap{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px}
  .top{display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:8px;font-weight:900;letter-spacing:.08em;font-size:15px}
  .dot{width:8px;height:8px;border-radius:99px;background:#10b981;box-shadow:0 0 10px #10b981}
  .pill{font-size:11px;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.07);border:1px solid var(--border);color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:16px}
  .title{font-size:17px;font-weight:800;line-height:1.25;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sub{font-size:12px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .seek-wrap{margin-top:14px}
  input[type=range]{width:100%;accent-color:var(--accent);height:6px;cursor:pointer}
  .times{display:flex;justify-content:space-between;font-family:ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:4px}
  .main-controls{display:grid;grid-template-columns:1fr 1.3fr 1fr;gap:10px;align-items:center}
  button{border:1px solid var(--border);background:rgba(255,255,255,.06);color:var(--text);border-radius:18px;font-weight:700;cursor:pointer;touch-action:manipulation;transition:transform .1s,background .15s}
  button:active{transform:scale(.94);background:rgba(255,255,255,.14)}
  .btn-play{height:76px;background:var(--accent);border-color:rgba(255,255,255,.18);font-size:28px;border-radius:24px;box-shadow:0 10px 28px rgba(225,29,72,.38)}
  .btn-play:active{background:#be123c}
  .btn-seek{height:64px;font-size:15px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .btn-sm{height:48px;font-size:13px;border-radius:16px;padding:0 12px}
  .vol-row{display:flex;align-items:center;gap:12px}
  .vol-btn{width:46px;height:44px;border-radius:14px;font-size:18px;flex-shrink:0}
  .eq-row{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:10px}
  .eq-btn{height:38px;font-size:11px;border-radius:12px;padding:0 4px}
  .eq-btn.active{background:rgba(225,29,72,.28);border-color:#f43f5e;color:#fff}
  .label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="brand"><span class="dot" id="dot"></span><span>RDX ПУЛЬТ</span></div>
    <span class="pill" id="statusPill">Підключено</span>
  </div>

  <div class="card">
    <h1 class="title" id="title">Очікування відео...</h1>
    <div class="sub" id="subtitle">Відкрийте фільм або серіал у RDX на ПК</div>
    <div class="seek-wrap">
      <input type="range" id="seek" min="0" max="100" value="0" step="1">
      <div class="times"><span id="curT">0:00</span><span id="durT">0:00</span></div>
    </div>
  </div>

  <div class="main-controls">
    <button class="btn-seek" onclick="cmd('seek_delta', -10)">⏪ -10с</button>
    <button class="btn-play" id="playBtn" onclick="cmd('toggle_play')">▶</button>
    <button class="btn-seek" onclick="cmd('seek_delta', 10)">+10с ⏩</button>
  </div>

  <div class="grid2" id="epRow" style="display:none">
    <button class="btn-sm" onclick="cmd('prev_episode')">⏮ Попередня серія</button>
    <button class="btn-sm" onclick="cmd('next_episode')">Наступна серія ⏭</button>
  </div>

  <div class="card">
    <div class="label" style="margin-bottom:8px">Гучність</div>
    <div class="vol-row">
      <button class="vol-btn" id="muteBtn" onclick="cmd('toggle_mute')">🔊</button>
      <input type="range" id="vol" min="0" max="100" value="100" step="2">
      <span id="volVal" style="font-family:ui-monospace,monospace;font-size:12px;width:36px;text-align:right">100%</span>
    </div>
  </div>

  <div class="card">
    <div class="label">Аудіо-пресет (Еквалайзер)</div>
    <div class="eq-row" id="eqRow">
      <button class="eq-btn" data-eq="off" onclick="cmd('set_audio_preset', null, 'off')">Станд.</button>
      <button class="eq-btn" data-eq="dialogue" onclick="cmd('set_audio_preset', null, 'dialogue')">Діалоги</button>
      <button class="eq-btn" data-eq="cinema" onclick="cmd('set_audio_preset', null, 'cinema')">Кіно</button>
      <button class="eq-btn" data-eq="night" onclick="cmd('set_audio_preset', null, 'night')">Ніч</button>
      <button class="eq-btn" data-eq="headphones" onclick="cmd('set_audio_preset', null, 'headphones')">Навушн.</button>
    </div>
  </div>

  <div class="grid2">
    <button class="btn-sm" onclick="cmd('seek_delta', -30)">⏪ -30с</button>
    <button class="btn-sm" onclick="cmd('toggle_fullscreen')">⛶ На весь екран</button>
  </div>
</div>

<script>
const $ = id => document.getElementById(id);
let draggingSeek = false, draggingVol = false;

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}` : `${m}:${String(sc).padStart(2,'0')}`;
}

async function cmd(action, value = null, str_value = null) {
  try {
    await fetch('/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, value, str_value })
    });
    setTimeout(poll, 120);
  } catch {}
}

$('seek').addEventListener('pointerdown', () => draggingSeek = true);
$('seek').addEventListener('pointerup', e => { draggingSeek = false; cmd('seek_to', Number(e.target.value)); });
$('seek').addEventListener('change', e => { draggingSeek = false; cmd('seek_to', Number(e.target.value)); });
$('seek').addEventListener('input', e => { $('curT').textContent = fmt(e.target.value); });

$('vol').addEventListener('pointerdown', () => draggingVol = true);
$('vol').addEventListener('input', e => { $('volVal').textContent = e.target.value + '%'; cmd('set_volume', Number(e.target.value) / 100); });
$('vol').addEventListener('pointerup', () => draggingVol = false);

async function poll() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    const s = await r.json();
    $('dot').style.background = '#10b981';
    $('statusPill').textContent = s.active ? (s.is_playing ? 'Відтворення' : 'На паузі') : 'В каталозі';
    $('title').textContent = s.active && s.title ? s.title : 'Очікування відео...';
    $('subtitle').textContent = s.active ? (s.subtitle || 'RDX Cinema') : 'Відкрийте фільм або серіал у RDX на ПК';
    $('playBtn').textContent = s.is_playing ? '⏸' : '▶';
    $('epRow').style.display = s.is_series ? 'grid' : 'none';
    if (!draggingSeek) {
      $('seek').max = Math.max(1, Math.floor(s.duration_sec || 0));
      $('seek').value = Math.floor(s.position_sec || 0);
      $('curT').textContent = fmt(s.position_sec);
      $('durT').textContent = fmt(s.duration_sec);
    }
    if (!draggingVol) {
      const vp = Math.round((s.volume ?? 1) * 100);
      $('vol').value = s.muted ? 0 : vp;
      $('volVal').textContent = (s.muted ? 0 : vp) + '%';
    }
    $('muteBtn').textContent = s.muted || s.volume === 0 ? '🔇' : '🔊';
    document.querySelectorAll('.eq-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.eq === (s.audio_preset || 'off'));
    });
  } catch {
    $('dot').style.background = '#ef4444';
    $('statusPill').textContent = 'Немає зв\'язку';
  }
}
poll();
setInterval(poll, 1000);
</script>
</body>
</html>"##;
