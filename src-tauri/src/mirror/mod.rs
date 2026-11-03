use std::sync::Arc;
use std::time::Instant;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use url::Url;
use crate::client::HttpClient;

pub const PRESET_MIRRORS: &[&str] = &[
    "https://rezka-tv.org",
    "https://rezka.ag",
    "https://hdrezka.me",
    "https://hdrezka.sh",
    "https://hdrezka.kim",
    "https://rezka.pub",
];

pub const DISCOVERY_CANDIDATES: &[&str] = &[
    "https://rezka-tv.org",
    "https://rezka.ag",
    "https://hdrezka.me",
    "https://hdrezka.sh",
    "https://hdrezka.kim",
    "https://rezka.pub",
    "https://rezkify.com",
    "https://rezka.fi",
    "https://hdrezka.cm",
    "https://rezka-ua.org",
    "https://rezka-ua.tv",
    "https://hdrezka.club",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorStatus {
    pub mirror_url: String,
    pub online: bool,
    pub latency_ms: u64,
    pub status_message: String,
    #[serde(default)]
    pub doh_bypass: bool,
    #[serde(default)]
    pub catalog_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartRotationResult {
    pub selected_mirror: String,
    pub switched: bool,
    pub statuses: Vec<MirrorStatus>,
}

pub struct MirrorManager;

impl MirrorManager {
    /// Normalizes URL by ensuring https protocol and trimming trailing slash
    pub fn normalize_url(url: &str) -> String {
        let trimmed = url.trim();
        let with_protocol = if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            format!("https://{}", trimmed)
        } else {
            trimmed.to_string()
        };
        with_protocol.trim_end_matches('/').to_string()
    }

    /// Checks the health, latency, DoH bypass status, and public catalog availability of a mirror URL
    pub async fn check_mirror_status(client: &HttpClient, mirror_url: &str) -> MirrorStatus {
        let normalized = Self::normalize_url(mirror_url);
        let host = Url::parse(&normalized)
            .ok()
            .and_then(|u| u.host_str().map(|s| s.to_lowercase()))
            .unwrap_or_default();

        if !host.is_empty() {
            client.ensure_host_resolved(&host).await;
        }
        let doh_bypass = client.is_doh_routed(&host);
        let start = Instant::now();

        match client.execute_with_anti_bot(Method::GET, &normalized, None, None, false).await {
            Ok(resp) => {
                let status_code = resp.status();
                let body_text = resp.text().await.unwrap_or_default();
                let latency_ms = start.elapsed().as_millis() as u64;

                let has_catalog = body_text.contains("b-content__inline_item");
                let is_login_wall = body_text.contains("Вход на HDrezka") && !has_catalog;

                if status_code.is_success() && has_catalog {
                    MirrorStatus {
                        mirror_url: normalized,
                        online: true,
                        latency_ms,
                        status_message: if doh_bypass {
                            "OK • DoH обхід".to_string()
                        } else {
                            "OK • Пряме".to_string()
                        },
                        doh_bypass,
                        catalog_available: true,
                    }
                } else if is_login_wall {
                    MirrorStatus {
                        mirror_url: normalized,
                        online: false,
                        latency_ms,
                        status_message: "Приватне (Вхід)".to_string(),
                        doh_bypass,
                        catalog_available: false,
                    }
                } else if status_code.as_u16() == 403 || status_code.as_u16() == 503 {
                    MirrorStatus {
                        mirror_url: normalized,
                        online: false,
                        latency_ms,
                        status_message: "Капча / Захист".to_string(),
                        doh_bypass,
                        catalog_available: false,
                    }
                } else {
                    MirrorStatus {
                        mirror_url: normalized,
                        online: false,
                        latency_ms,
                        status_message: "Недоступне".to_string(),
                        doh_bypass,
                        catalog_available: false,
                    }
                }
            }
            Err(_) => MirrorStatus {
                mirror_url: normalized,
                online: false,
                latency_ms: 0,
                status_message: "Заблоковано / Таймаут".to_string(),
                doh_bypass,
                catalog_available: false,
            },
        }
    }

    /// Probes multiple mirrors concurrently with batch DoH resolution
    pub async fn check_all_mirrors(client: Arc<HttpClient>, mirror_urls: Vec<String>) -> Vec<MirrorStatus> {
        let mut unique_urls = Vec::new();
        let mut hosts = Vec::new();

        for raw in mirror_urls {
            let norm = Self::normalize_url(&raw);
            if !norm.is_empty() && !unique_urls.contains(&norm) {
                if let Ok(parsed) = Url::parse(&norm) {
                    if let Some(h) = parsed.host_str() {
                        hosts.push(h.to_lowercase());
                    }
                }
                unique_urls.push(norm);
            }
        }

        // Batch-resolve all candidate hosts via system DNS / DoH concurrently first
        client.ensure_hosts_resolved(&hosts).await;

        let mut join_set = tokio::task::JoinSet::new();
        for url in unique_urls.clone() {
            let c = client.clone();
            join_set.spawn(async move { Self::check_mirror_status(&c, &url).await });
        }

        let mut results = Vec::new();
        while let Some(Ok(status)) = join_set.join_next().await {
            results.push(status);
        }

        // Sort: working catalog mirrors first (by lowest latency), then others
        results.sort_by(|a, b| match (a.online && a.catalog_available, b.online && b.catalog_available) {
            (true, true) => a.latency_ms.cmp(&b.latency_ms),
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (false, false) => a.mirror_url.cmp(&b.mirror_url),
        });

        results
    }

    /// Discovers working mirrors from the extended pool + DoH resolution
    pub async fn discover_mirrors(client: Arc<HttpClient>, extra_urls: &[String]) -> Vec<MirrorStatus> {
        let mut pool: Vec<String> = DISCOVERY_CANDIDATES.iter().map(|s| s.to_string()).collect();
        for u in extra_urls {
            let norm = Self::normalize_url(u);
            if !pool.contains(&norm) {
                pool.push(norm);
            }
        }
        Self::check_all_mirrors(client, pool).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url() {
        assert_eq!(MirrorManager::normalize_url("rezka-tv.org"), "https://rezka-tv.org");
        assert_eq!(MirrorManager::normalize_url("https://rezka-tv.org/"), "https://rezka-tv.org");
        assert_eq!(MirrorManager::normalize_url("http://hdrezka.me/"), "http://hdrezka.me");
    }
}
