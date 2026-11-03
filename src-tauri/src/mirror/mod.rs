use std::time::Instant;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use crate::client::HttpClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorStatus {
    pub mirror_url: String,
    pub online: bool,
    pub latency_ms: u64,
    pub status_message: String,
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

    /// Checks the health and latency of a mirror URL
    pub async fn check_mirror_status(client: &HttpClient, mirror_url: &str) -> MirrorStatus {
        let normalized = Self::normalize_url(mirror_url);
        let start = Instant::now();

        match client.execute_with_anti_bot(Method::GET, &normalized, None, None, false).await {
            Ok(resp) => {
                let latency_ms = start.elapsed().as_millis() as u64;
                let status_code = resp.status();

                if status_code.is_success() {
                    MirrorStatus {
                        mirror_url: normalized,
                        online: true,
                        latency_ms,
                        status_message: "OK".to_string(),
                    }
                } else if status_code.as_u16() == 403 || status_code.as_u16() == 503 {
                    MirrorStatus {
                        mirror_url: normalized,
                        online: true,
                        latency_ms,
                        status_message: "Captcha / Protection Required".to_string(),
                    }
                } else {
                    MirrorStatus {
                        mirror_url: normalized,
                        online: false,
                        latency_ms,
                        status_message: format!("HTTP {}", status_code.as_u16()),
                    }
                }
            }
            Err(e) => {
                MirrorStatus {
                    mirror_url: normalized,
                    online: false,
                    latency_ms: 0,
                    status_message: format!("Unreachable: {}", e),
                }
            }
        }
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
