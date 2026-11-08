use std::time::Instant;
use url::Url;
use crate::client::HttpClient;
use crate::parser::models::StreamData;

/// Known Voidboost CDN edge domains
const VOIDBOOST_CDN_EDGES: &[&str] = &[
    "stream.voidboost.cc",
    "stream.voidboost.net",
    "stream.voidboost.one",
    "v1.voidboost.to",
    "voidboost.pw",
];

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
                if status.is_success() || status.as_u16() < 500 {
                    let elapsed = start.elapsed().as_millis() as u64;
                    Some(elapsed)
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    }

    /// Finds the lowest-latency CDN edge for a given stream URL.
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

        // If not a Voidboost CDN domain, return original host
        if !orig_host.contains("voidboost") {
            return (orig_host, 0);
        }

        let path = parsed.path();
        let sample_path = if path.is_empty() { "/" } else { path };

        // Test candidate CDN edges concurrently
        let mut candidates = vec![orig_host.clone()];
        for edge in VOIDBOOST_CDN_EDGES {
            if *edge != orig_host {
                candidates.push(edge.to_string());
            }
        }

        let reqwest_client = client.get_reqwest_client();
        let mut tasks = Vec::new();
        for host in candidates {
            let cl = reqwest_client.clone();
            let path_clone = sample_path.to_string();
            tasks.push(tokio::spawn(async move {
                let latency = Self::ping_host(&cl, &host, &path_clone).await;
                (host, latency)
            }));
        }

        let mut fastest_host = orig_host.clone();
        let mut lowest_ping = u64::MAX;

        for task in tasks {
            if let Ok((host, Some(ping))) = task.await {
                if ping < lowest_ping {
                    lowest_ping = ping;
                    fastest_host = host;
                }
            }
        }

        if lowest_ping == u64::MAX {
            (orig_host, 0)
        } else {
            (fastest_host, lowest_ping)
        }
    }

    /// Rewrites all qualities in `StreamData` to use the fastest CDN edge
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

        let (fastest_host, ping_ms) = Self::select_fastest_cdn(client, &target_url).await;

        if fastest_host != "auto" && !fastest_host.is_empty() {
            // Rewrite all stream URLs to the fastest CDN edge
            for q in &mut stream.qualities {
                if let Some(ref hls) = q.hls_url {
                    if let Ok(mut u) = Url::parse(hls) {
                        let _ = u.set_host(Some(&fastest_host));
                        q.hls_url = Some(u.to_string());
                    }
                }
                if let Some(ref mp4) = q.mp4_url {
                    if let Ok(mut u) = Url::parse(mp4) {
                        let _ = u.set_host(Some(&fastest_host));
                        q.mp4_url = Some(u.to_string());
                    }
                }
            }

            stream.cdn_host = Some(fastest_host);
            stream.cdn_ping_ms = if ping_ms > 0 { Some(ping_ms) } else { None };
        }
    }
}
