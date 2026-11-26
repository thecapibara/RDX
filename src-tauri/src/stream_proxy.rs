use std::io::ErrorKind;
use std::net::TcpListener as StdTcpListener;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{Client, Method};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use url::Url;

use crate::client::DEFAULT_USER_AGENT;
use crate::parser::models::StreamData;

static PROXY_PORT: OnceLock<u16> = OnceLock::new();

/// Starts the local loopback (`127.0.0.1:<ephemeral>`) CORS & HLS/MP4 stream proxy once.
/// Enables WebKitGTK / WebView2 / WKWebView to play HLS manifests, `.ts` segments, Range `.mp4`
/// streams, and WebVTT sprite thumbnails with `Access-Control-Allow-Origin: *` so WebGL2/WebGL1
/// `texSubImage2D` (Frame Boost 60 FPS & Smart Upscaler), Ambilight, Screenshots, and WebAudio work
/// on every CDN storage edge regardless of upstream 302 redirect CORS headers.
pub fn ensure_started() -> Option<u16> {
    if let Some(&port) = PROXY_PORT.get() {
        return Some(port);
    }

    let std_listener = StdTcpListener::bind("127.0.0.1:0").ok()?;
    std_listener.set_nonblocking(true).ok()?;
    let port = std_listener.local_addr().ok()?.port();

    if PROXY_PORT.set(port).is_ok() {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(12))
            .read_timeout(Duration::from_secs(30))
            .tcp_nodelay(true)
            .pool_max_idle_per_host(16)
            .pool_idle_timeout(Duration::from_secs(90))
            .redirect(reqwest::redirect::Policy::limited(10))
            .user_agent(DEFAULT_USER_AGENT)
            .build()
            .unwrap_or_default();

        tauri::async_runtime::spawn(async move {
            let Ok(listener) = TcpListener::from_std(std_listener) else {
                return;
            };
            loop {
                match listener.accept().await {
                    Ok((socket, _)) => {
                        let _ = socket.set_nodelay(true);
                        let c = client.clone();
                        tokio::spawn(async move {
                            let _ = handle_connection(socket, c, port).await;
                        });
                    }
                    Err(e) if e.kind() == ErrorKind::Interrupted => continue,
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(25)).await;
                    }
                }
            }
        });
    }

    PROXY_PORT.get().copied()
}

pub fn wrap_url_with_port(port: u16, raw_url: &str) -> String {
    let trimmed = raw_url.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("http://127.0.0.1:")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("blob:")
        || trimmed.starts_with("asset:")
    {
        return trimmed.to_string();
    }
    format!(
        "http://127.0.0.1:{}/proxy?url={}",
        port,
        urlencoding::encode(trimmed)
    )
}

pub fn unwrap_url(maybe_proxied: &str) -> String {
    if maybe_proxied.starts_with("http://127.0.0.1:") && maybe_proxied.contains("/proxy?") {
        if let Ok(parsed) = Url::parse(maybe_proxied) {
            for (k, v) in parsed.query_pairs() {
                if k == "url" && !v.is_empty() {
                    return v.into_owned();
                }
            }
        }
    }
    maybe_proxied.to_string()
}

pub fn wrap_stream_data(stream: &mut StreamData) {
    let Some(port) = ensure_started() else {
        return;
    };

    for q in &mut stream.qualities {
        if let Some(ref hls) = q.hls_url {
            q.hls_url = Some(wrap_url_with_port(port, hls));
        }
        if let Some(ref mp4) = q.mp4_url {
            q.mp4_url = Some(wrap_url_with_port(port, mp4));
        }
    }

    for sub in &mut stream.subtitles {
        sub.url = wrap_url_with_port(port, &sub.url);
    }

    if let Some(ref thumbs) = stream.thumbnails {
        stream.thumbnails = Some(wrap_url_with_port(port, thumbs));
    }
}

fn is_safe_remote_url(u: &Url) -> bool {
    let scheme = u.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let Some(host) = u.host_str() else {
        return false;
    };
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower == "127.0.0.1" || lower == "::1" || lower == "0.0.0.0" {
        return false;
    }
    true
}

fn resolve_relative_or_abs(base_url: &Url, raw_ref: &str) -> String {
    let t = raw_ref.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        return t.to_string();
    }
    let safe_rel = if !t.starts_with('/') && !t.starts_with("./") && !t.starts_with("../") && t.contains(':') {
        // Prevent RFC 3986 from treating Voidboost `1080.mp4:hls:seg-1.ts` as a `1080.mp4:` URL scheme!
        format!("./{}", t)
    } else {
        t.to_string()
    };
    base_url
        .join(&safe_rel)
        .map(|u| u.to_string())
        .unwrap_or_else(|_| t.to_string())
}

fn rewrite_uri_attribute(line: &str, base: &Url, port: u16) -> String {
    let Some(start_idx) = line.find("URI=\"") else {
        return line.to_string();
    };
    let after_quote = start_idx + 5;
    let Some(rel_end) = line[after_quote..].find('"') else {
        return line.to_string();
    };
    let raw_uri = &line[after_quote..after_quote + rel_end];
    let resolved = resolve_relative_or_abs(base, raw_uri);
    let proxied = wrap_url_with_port(port, &resolved);
    format!(
        "{}{}{}",
        &line[..after_quote],
        proxied,
        &line[after_quote + rel_end..]
    )
}

fn rewrite_m3u8(manifest: &str, base_url: &Url, port: u16) -> String {
    let mut out = String::with_capacity(manifest.len() + 1024);
    for raw_line in manifest.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        if trimmed.starts_with('#') {
            if trimmed.contains("URI=\"") {
                out.push_str(&rewrite_uri_attribute(trimmed, base_url, port));
            } else {
                out.push_str(trimmed);
            }
            out.push('\n');
            continue;
        }

        let resolved = resolve_relative_or_abs(base_url, trimmed);
        out.push_str(&wrap_url_with_port(port, &resolved));
        out.push('\n');
    }
    out
}

fn rewrite_vtt_sprites(vtt: &str, base_url: &Url, port: u16) -> String {
    if !vtt.contains("#xywh=") {
        return vtt.to_string();
    }
    let mut out = String::with_capacity(vtt.len() + 512);
    for raw_line in vtt.lines() {
        let trimmed = raw_line.trim();
        if let Some(hash_idx) = trimmed.find("#xywh=") {
            if !trimmed.starts_with('#') && !trimmed.contains("-->") {
                let img_part = &trimmed[..hash_idx];
                let xywh_part = &trimmed[hash_idx..];
                let resolved = base_url
                    .join(img_part)
                    .map(|u| u.to_string())
                    .unwrap_or_else(|_| img_part.to_string());
                out.push_str(&wrap_url_with_port(port, &resolved));
                out.push_str(xywh_part);
                out.push('\n');
                continue;
            }
        }
        out.push_str(raw_line);
        out.push('\n');
    }
    out
}

async fn handle_connection(
    mut socket: TcpStream,
    client: Client,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = vec![0u8; 16384];
    let mut filled = 0usize;

    loop {
        if filled >= buf.len() {
            return Ok(());
        }
        let n = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut buf[filled..])).await??;
        if n == 0 {
            return Ok(());
        }
        filled += n;
        if buf[..filled].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }

    let req_str = String::from_utf8_lossy(&buf[..filled]);
    let mut lines = req_str.lines();
    let Some(first_line) = lines.next() else {
        return Ok(());
    };

    let mut parts = first_line.split_whitespace();
    let method_str = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    if method_str.eq_ignore_ascii_case("OPTIONS") {
        let cors_preflight = concat!(
            "HTTP/1.1 204 No Content\r\n",
            "Access-Control-Allow-Origin: *\r\n",
            "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n",
            "Access-Control-Allow-Headers: *\r\n",
            "Access-Control-Max-Age: 86400\r\n",
            "Connection: close\r\n\r\n"
        );
        socket.write_all(cors_preflight.as_bytes()).await?;
        return Ok(());
    }

    let is_head = method_str.eq_ignore_ascii_case("HEAD");
    if !is_head && !method_str.eq_ignore_ascii_case("GET") {
        socket
            .write_all(b"HTTP/1.1 405 Method Not Allowed\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }

    let dummy_base = format!("http://127.0.0.1:{}{}", port, target);
    let Ok(parsed_local) = Url::parse(&dummy_base) else {
        socket
            .write_all(b"HTTP/1.1 400 Bad Request\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };

    let mut remote_raw = None;
    for (k, v) in parsed_local.query_pairs() {
        if k == "url" && !v.is_empty() {
            remote_raw = Some(v.into_owned());
            break;
        }
    }

    let Some(remote_str) = remote_raw else {
        socket
            .write_all(b"HTTP/1.1 400 Bad Request\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };

    let Ok(remote_url) = Url::parse(&remote_str) else {
        socket
            .write_all(b"HTTP/1.1 400 Bad Request\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };

    if !is_safe_remote_url(&remote_url) {
        socket
            .write_all(b"HTTP/1.1 403 Forbidden\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }

    let mut range_header: Option<String> = None;
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, val)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("range") {
                range_header = Some(val.trim().to_string());
                break;
            }
        }
    }

    let mut req_builder = client
        .request(if is_head { Method::HEAD } else { Method::GET }, remote_url.clone())
        .header("Accept", "*/*")
        // Request identity encoding so binary Content-Length / Content-Range match byte-for-byte
        .header("Accept-Encoding", "identity");

    if let Some(ref rng) = range_header {
        req_builder = req_builder.header("Range", rng);
    }

    let resp = match req_builder.send().await {
        Ok(r) => r,
        Err(_) => {
            socket
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
                .await?;
            return Ok(());
        }
    };

    let status_code = resp.status().as_u16();
    let reason = resp.status().canonical_reason().unwrap_or("OK");
    let final_url = resp.url().clone();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let is_m3u8 = !is_head
        && (200..300).contains(&status_code)
        && (final_url.path().ends_with(".m3u8")
            || remote_str.contains(".m3u8")
            || content_type.to_ascii_lowercase().contains("mpegurl"));

    if is_m3u8 {
        let body_text = resp.text().await.unwrap_or_default();
        let rewritten = rewrite_m3u8(&body_text, &final_url, port);
        let bytes = rewritten.as_bytes();
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Length\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
            bytes.len()
        );
        socket.write_all(header.as_bytes()).await?;
        socket.write_all(bytes).await?;
        return Ok(());
    }

    let is_vtt = !is_head
        && (200..300).contains(&status_code)
        && (final_url.path().ends_with(".vtt")
            || remote_str.ends_with(".vtt")
            || content_type.to_ascii_lowercase().contains("text/vtt"));

    if is_vtt {
        let body_text = resp.text().await.unwrap_or_default();
        let rewritten = rewrite_vtt_sprites(&body_text, &final_url, port);
        let bytes = rewritten.as_bytes();
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/vtt; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: public, max-age=600\r\nConnection: close\r\n\r\n",
            bytes.len()
        );
        socket.write_all(header.as_bytes()).await?;
        socket.write_all(bytes).await?;
        return Ok(());
    }

    let mut hdr = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\nAccept-Ranges: bytes\r\n",
        status_code, reason, content_type
    );

    if let Some(cl) = resp.headers().get("content-length").and_then(|v| v.to_str().ok()) {
        hdr.push_str(&format!("Content-Length: {}\r\n", cl));
    }
    if let Some(cr) = resp.headers().get("content-range").and_then(|v| v.to_str().ok()) {
        hdr.push_str(&format!("Content-Range: {}\r\n", cr));
    }
    hdr.push_str("Connection: close\r\n\r\n");

    socket.write_all(hdr.as_bytes()).await?;

    if !is_head {
        let mut resp = resp;
        while let Ok(Some(chunk)) = resp.chunk().await {
            if socket.write_all(&chunk).await.is_err() {
                break;
            }
        }
    }

    Ok(())
}
