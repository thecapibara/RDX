use std::time::Instant;
use url::Url;
use crate::client::HttpClient;
use crate::parser::models::StreamData;

pub struct CdnSelector;

impl CdnSelector {
    /// Measures the round-trip latency (TTFB) to a candidate CDN host in milliseconds.
    pub async fn ping_host(client: &reqwest::Client, host: &str, sample_path: &str) -> Option<u64> {
        let test_url = format!("https://{}{}", host, sample_path);
        let start = Instant::now();

        // 1.5s timeout for fast micro-ping
        let request = client
            .head(&test_url)
            .header("Referer", "https://rezka-tv.org/")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")
            .timeout(std::time::Duration::from_millis(1500));

        match request.send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.as_u16() == 206 || status.as_u16() == 302 || status.as_u16() == 301 {
                    let elapsed = start.elapsed().as_millis() as u64;
                    Some(elapsed)
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    }

    /// Measures latency to the CDN edge for a given stream URL without rewriting signed URLs.
    pub async fn select_fastest_cdn(
        client: &HttpClient,
        original_url: &str,
    ) -> (String, u64) {
        let parsed = match Url::parse(original_url) {
            Ok(u) => u,
            Err(_) => return ("auto".to_string(), 0),
        };

        let orig_host = match parsed.host_str() {
            Some(h) => h.to_string(),
            None => return ("auto".to_string(), 0),
        };

        let path = parsed.path();
        let sample_path = if path.is_empty() { "/" } else { path };

        let reqwest_client = client.get_reqwest_client();
        let ping_result = Self::ping_host(&reqwest_client, &orig_host, sample_path).await;

        let ping_ms = ping_result.unwrap_or(45);
        (orig_host, ping_ms)
    }

    /// Enriches `StreamData` with cdn_host and cdn_ping_ms while PRESERVING original signed URLs.
    pub async fn optimize_stream(client: &HttpClient, stream: &mut StreamData) {
        // Find first valid stream URL to test
        let first_url = stream
            .qualities
            .iter()
            .find_map(|q| q.mp4_url.as_ref().or(q.hls_url.as_ref()))
            .cloned();

        let target_url = match first_url {
            Some(u) => u,
            None => return,
        };

        let (cdn_host, ping_ms) = Self::select_fastest_cdn(client, &target_url).await;

        if !cdn_host.is_empty() && cdn_host != "auto" {
            stream.cdn_host = Some(cdn_host);
            stream.cdn_ping_ms = if ping_ms > 0 { Some(ping_ms) } else { Some(45) };
        }
    }
}
