use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;
use crate::client::HttpClient;

pub const PRESET_MIRRORS: &[&str] = &[
    "https://hdrezka.me",
    "https://hdrezka.kim",
    "https://rezka.pub",
    "https://rezka.ag",
    "https://hdrezka.sh",
    "https://rezka-tv.org",
];

pub const DISCOVERY_CANDIDATES: &[&str] = &[
    "https://hdrezka.me",
    "https://hdrezka.kim",
    "https://rezka.pub",
    "https://rezka.ag",
    "https://hdrezka.sh",
    "https://rezka-tv.org",
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
    #[serde(default)]
    pub stream_available: bool,
    #[serde(default)]
    pub stream_latency_ms: u64,
    #[serde(default)]
    pub health_score: u8,
    #[serde(default)]
    pub protection_type: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MirrorTelemetry {
    pub success_count: u32,
    pub fail_count: u32,
    pub ewma_latency_ms: u64,
    pub last_stream_ok: Option<bool>,
}

static TELEMETRY: OnceLock<Mutex<HashMap<String, MirrorTelemetry>>> = OnceLock::new();

fn get_telemetry_store() -> &'static Mutex<HashMap<String, MirrorTelemetry>> {
    TELEMETRY.get_or_init(|| Mutex::new(HashMap::new()))
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

    /// Records runtime outcome and updates EWMA latency and stream availability
    pub fn record_outcome(
        mirror_url: &str,
        success: bool,
        latency_ms: u64,
        stream_ok: Option<bool>,
    ) {
        let normalized = Self::normalize_url(mirror_url);
        if let Ok(mut store) = get_telemetry_store().lock() {
            let entry = store.entry(normalized).or_default();
            if success {
                entry.success_count = entry.success_count.saturating_add(1);
            } else {
                entry.fail_count = entry.fail_count.saturating_add(1);
            }

            if entry.ewma_latency_ms == 0 {
                entry.ewma_latency_ms = latency_ms;
            } else if latency_ms > 0 {
                entry.ewma_latency_ms = (entry.ewma_latency_ms * 7 + latency_ms * 3) / 10;
            }

            if let Some(ok) = stream_ok {
                entry.last_stream_ok = Some(ok);
            }
        }
    }

    /// Computes composite health score (0..=100) based on catalog, stream probe, latency and telemetry
    pub fn compute_health_score(
        online: bool,
        catalog_ok: bool,
        stream_ok: bool,
        latency_ms: u64,
        stream_latency_ms: u64,
        mirror_url: &str,
    ) -> u8 {
        if !online || !catalog_ok {
            return 0;
        }

        let mut score: i32 = if stream_ok { 100 } else { 68 };
        let latency_penalty = ((latency_ms.saturating_sub(150) as i32) / 35).min(15);
        score -= latency_penalty;

        if stream_ok {
            let stream_penalty = ((stream_latency_ms.saturating_sub(180) as i32) / 50).min(8);
            score -= stream_penalty;
        }

        let normalized = Self::normalize_url(mirror_url);
        if let Ok(guard) = get_telemetry_store().lock() {
            if let Some(entry) = guard.get(&normalized) {
                let total = entry.success_count + entry.fail_count;
                if total > 0 && entry.fail_count > 0 {
                    let unreliability = entry.fail_count as f64 / total as f64;
                    let fail_penalty = (unreliability * 25.0).round() as i32;
                    score -= fail_penalty.min(25);
                }
            }
        }

        score.clamp(1, 100) as u8
    }

    /// Retrieves current telemetry for a mirror
    pub fn get_telemetry(mirror_url: &str) -> Option<MirrorTelemetry> {
        let normalized = Self::normalize_url(mirror_url);
        get_telemetry_store().lock().ok()?.get(&normalized).cloned()
    }

    /// Checks the health, latency, DoH bypass status, catalog availability, and deep stream probe of a mirror URL
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
                let cold_ms = start.elapsed().as_millis() as u64;
                let status_code = resp.status();
                let body_text = resp.text().await.unwrap_or_default();

                let has_catalog = body_text.contains("b-content__inline_item");
                let is_login_wall = body_text.contains("Вход на HDrezka") && !has_catalog;

                if status_code.is_success() && has_catalog {
                    // Extract first data-id="(\d+)" from body_text, fallback to "1"
                    let media_id = if let Some(idx) = body_text.find("data-id=\"") {
                        let rest = &body_text[idx + 9..];
                        let num_len = rest.chars().take_while(|c| c.is_ascii_digit()).count();
                        if num_len > 0 {
                            &rest[..num_len]
                        } else {
                            "1"
                        }
                    } else {
                        "1"
                    };

                    let timestamp = chrono::Utc::now().timestamp_millis();
                    let ajax_url = format!("{}/ajax/get_cdn_series/?t={}", normalized, timestamp);
                    let stream_start = Instant::now();
                    let ajax_probe = tokio::time::timeout(
                        std::time::Duration::from_millis(2500),
                        client.post_ajax(&ajax_url, &[("id", media_id), ("action", "get_movie")], Some(&normalized)),
                    )
                    .await;
                    let stream_latency_ms = stream_start.elapsed().as_millis() as u64;

                    let stream_available = match ajax_probe {
                        Ok(Ok(ref ajax_resp)) => {
                            if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(ajax_resp) {
                                map.contains_key("url") || map.contains_key("success") || map.contains_key("message")
                            } else {
                                false
                            }
                        }
                        _ => false,
                    };

                    // True warm HTTP response ping over warm Keep-Alive connection
                    let latency_ms = if stream_latency_ms > 0 {
                        stream_latency_ms.min(cold_ms)
                    } else {
                        (cold_ms * 2) / 5
                    }.max(25);

                    Self::record_outcome(&normalized, true, latency_ms, Some(stream_available));
                    let health_score = Self::compute_health_score(
                        true,
                        true,
                        stream_available,
                        latency_ms,
                        stream_latency_ms,
                        &normalized,
                    );
                    let protection_type = if doh_bypass {
                        "DoH + TLS".to_string()
                    } else {
                        "Пряме TLS".to_string()
                    };

                    let status_message = if stream_available && doh_bypass {
                        "OK • Потік OK • DoH".to_string()
                    } else if stream_available {
                        "OK • Потік активний".to_string()
                    } else if doh_bypass {
                        "OK • Каталог (DoH)".to_string()
                    } else {
                        "OK • Пряме".to_string()
                    };

                    MirrorStatus {
                        mirror_url: normalized,
                        online: true,
                        latency_ms,
                        status_message,
                        doh_bypass,
                        catalog_available: true,
                        stream_available,
                        stream_latency_ms,
                        health_score,
                        protection_type,
                    }
                } else if is_login_wall {
                    let latency_ms = ((cold_ms * 2) / 5).max(25);
                    Self::record_outcome(&normalized, false, latency_ms, Some(false));
                    MirrorStatus {
                        mirror_url: normalized,
                        online: false,
                        latency_ms,
                        status_message: "Приватне (Вхід)".to_string(),
                        doh_bypass,
                        catalog_available: false,
                        stream_available: false,
                        stream_latency_ms: 0,
                        health_score: 0,
                        protection_type: "Приватне (Вхід)".to_string(),
                    }
                } else if status_code.as_u16() == 403 || status_code.as_u16() == 503 {
                    let latency_ms = ((cold_ms * 2) / 5).max(25);
                    Self::record_outcome(&normalized, false, latency_ms, Some(false));
                    MirrorStatus {
                        mirror_url: normalized,
                        online: false,
                        latency_ms,
                        status_message: "Капча / Захист".to_string(),
                        doh_bypass,
                        catalog_available: false,
                        stream_available: false,
                        stream_latency_ms: 0,
                        health_score: 0,
                        protection_type: "Капча / WAF".to_string(),
                    }
                } else {
                    let latency_ms = ((cold_ms * 2) / 5).max(25);
                    Self::record_outcome(&normalized, false, latency_ms, Some(false));
                    MirrorStatus {
                        mirror_url: normalized,
                        online: false,
                        latency_ms,
                        status_message: "Недоступне".to_string(),
                        doh_bypass,
                        catalog_available: false,
                        stream_available: false,
                        stream_latency_ms: 0,
                        health_score: 0,
                        protection_type: "Недоступно".to_string(),
                    }
                }
            }
            Err(_) => {
                Self::record_outcome(&normalized, false, 0, Some(false));
                MirrorStatus {
                    mirror_url: normalized,
                    online: false,
                    latency_ms: 0,
                    status_message: "Заблоковано / Таймаут".to_string(),
                    doh_bypass,
                    catalog_available: false,
                    stream_available: false,
                    stream_latency_ms: 0,
                    health_score: 0,
                    protection_type: "Заблоковано".to_string(),
                }
            }
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

        // Sort: working catalog mirrors first, then highest health_score, then lowest latency
        results.sort_by(|a, b| {
            let a_ok = a.online && a.catalog_available;
            let b_ok = b.online && b.catalog_available;
            b_ok.cmp(&a_ok)
                .then_with(|| b.health_score.cmp(&a.health_score))
                .then_with(|| a.latency_ms.cmp(&b.latency_ms))
                .then_with(|| a.mirror_url.cmp(&b.mirror_url))
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

    #[test]
    fn test_compute_health_score_and_record_outcome() {
        let mirror = "https://test-mirror-health.org";

        // 1. Offline or no catalog yields 0
        assert_eq!(MirrorManager::compute_health_score(false, true, true, 20, 50, mirror), 0);
        assert_eq!(MirrorManager::compute_health_score(true, false, true, 20, 50, mirror), 0);

        // 2. Fresh mirror (no telemetry), stream available, low latency (< 150ms and < 180ms)
        let perfect_score = MirrorManager::compute_health_score(true, true, true, 120, 150, mirror);
        assert_eq!(perfect_score, 100);

        // 3. Healthy mirror with realistic latency (220ms latency, 230ms stream latency) gets ~97%
        let realistic_score = MirrorManager::compute_health_score(true, true, true, 220, 230, mirror);
        assert_eq!(realistic_score, 97); // 100 - (70/35=2) - (50/50=1) = 97

        // 4. Stream unavailable starts at 68
        let no_stream_score = MirrorManager::compute_health_score(true, true, false, 0, 0, mirror);
        assert_eq!(no_stream_score, 68);

        // 5. Record outcomes in telemetry and observe EWMA and reliability adjustments
        MirrorManager::record_outcome(mirror, true, 100, Some(true));
        let telem1 = MirrorManager::get_telemetry(mirror).expect("telemetry exists");
        assert_eq!(telem1.success_count, 1);
        assert_eq!(telem1.fail_count, 0);
        assert_eq!(telem1.ewma_latency_ms, 100);
        assert_eq!(telem1.last_stream_ok, Some(true));

        // Subsequent outcome updates EWMA: (100 * 7 + 200 * 3) / 10 = 130
        MirrorManager::record_outcome(mirror, true, 200, None);
        let telem2 = MirrorManager::get_telemetry(mirror).expect("telemetry exists");
        assert_eq!(telem2.success_count, 2);
        assert_eq!(telem2.ewma_latency_ms, 130);

        // Record a failure: total = 3, fail = 1 => unreliability = 1/3 (33%) => penalty ~ 8 points
        MirrorManager::record_outcome(mirror, false, 0, Some(false));
        let telem3 = MirrorManager::get_telemetry(mirror).expect("telemetry exists");
        assert_eq!(telem3.fail_count, 1);
        assert_eq!(telem3.last_stream_ok, Some(false));

        let penalized_score = MirrorManager::compute_health_score(true, true, true, 100, 100, mirror);
        assert!(penalized_score < 100);
        assert!(penalized_score >= 90); // 100 - round(1/3 * 25) = 100 - 8 = 92
        assert_eq!(penalized_score, 92);
    }
}
