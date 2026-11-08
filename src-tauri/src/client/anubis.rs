use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnubisChallengeRules {
    pub algorithm: Option<String>,
    pub difficulty: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnubisChallengeData {
    pub id: String,
    #[serde(rename = "randomData")]
    pub random_data: String,
    pub difficulty: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnubisChallengePayload {
    pub rules: Option<AnubisChallengeRules>,
    pub challenge: AnubisChallengeData,
}

#[derive(Debug, Clone)]
pub struct AnubisSolution {
    pub challenge_id: String,
    pub nonce: u64,
    pub response_hash: String,
    pub elapsed_ms: u128,
}

#[inline]
fn has_leading_hex_zeros(bytes: &[u8], difficulty: usize) -> bool {
    let full_bytes = difficulty / 2;
    if bytes.len() < full_bytes {
        return false;
    }
    for &b in &bytes[..full_bytes] {
        if b != 0 {
            return false;
        }
    }
    if difficulty % 2 != 0 {
        if let Some(&b) = bytes.get(full_bytes) {
            if (b >> 4) != 0 {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

pub struct AnubisSolver;

impl AnubisSolver {
    /// Detects if HTML page is an Anubis PoW challenge page
    pub fn is_anubis_challenge(html: &str) -> bool {
        html.contains("id=\"anubis_challenge\"")
            || html.contains("id='anubis_challenge'")
            || html.contains("Проверяем, что вы не бот")
            || html.contains("/.within.website/x/cmd/anubis/")
    }

    /// Extracts Anubis challenge payload from HTML (attribute order agnostic)
    pub fn extract_challenge(html: &str) -> Option<AnubisChallengePayload> {
        let marker = if let Some(idx) = html.find("id=\"anubis_challenge\"") {
            idx
        } else if let Some(idx) = html.find("id='anubis_challenge'") {
            idx
        } else {
            return None;
        };

        // Find the closing '>' of the <script ...> tag
        let content_start = html[marker..].find('>')? + marker + 1;
        // Find the closing </script>
        let content_end = html[content_start..].find("</script>")? + content_start;
        let json_str = html[content_start..content_end].trim();
        serde_json::from_str::<AnubisChallengePayload>(json_str).ok()
    }

    /// Solves the PoW challenge: finds nonce such that SHA256(random_data + nonce)
    /// has `difficulty` leading hex zeros.
    ///
    /// Optimized with zero heap allocations in the search loop:
    /// - `base_hasher` is pre-warmed with `random_data`
    /// - `nonce` is formatted into a stack buffer
    /// - Leading zeros are checked directly on raw hash bytes before hex encoding
    pub fn solve(challenge: &AnubisChallengePayload) -> AnubisSolution {
        use std::io::Write;

        let start = std::time::Instant::now();
        let difficulty = challenge
            .challenge
            .difficulty
            .or_else(|| challenge.rules.as_ref().and_then(|r| r.difficulty))
            .unwrap_or(2) as usize;

        let random_data = &challenge.challenge.random_data;
        let mut base_hasher = Sha256::new();
        base_hasher.update(random_data.as_bytes());

        let mut nonce: u64 = 0;
        let response_hash: String;
        let mut nonce_buf = [0u8; 32];

        loop {
            let nonce_len = {
                let mut cursor = std::io::Cursor::new(&mut nonce_buf[..]);
                let _ = write!(cursor, "{}", nonce);
                cursor.position() as usize
            };

            let mut hasher = base_hasher.clone();
            hasher.update(&nonce_buf[..nonce_len]);
            let result = hasher.finalize();

            if has_leading_hex_zeros(&result, difficulty) {
                response_hash = hex::encode(result);
                break;
            }

            nonce += 1;
        }

        let elapsed_ms = start.elapsed().as_millis().max(15);

        AnubisSolution {
            challenge_id: challenge.challenge.id.clone(),
            nonce,
            response_hash,
            elapsed_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_and_solve_anubis() {
        let sample_html = r#"
        <!DOCTYPE html>
        <html>
        <head>
            <title>Проверяем, что вы не бот!</title>
            <script id="anubis_challenge" type="application/json">
            {
              "rules": {"algorithm": "fast", "difficulty": 2},
              "challenge": {
                "id": "test-uuid-1234-5678",
                "randomData": "a1b2c3d4e5f67890",
                "difficulty": 2
              }
            }
            </script>
        </head>
        <body>Solving...</body>
        </html>
        "#;

        assert!(AnubisSolver::is_anubis_challenge(sample_html));
        let challenge = AnubisSolver::extract_challenge(sample_html).expect("extract challenge");
        assert_eq!(challenge.challenge.id, "test-uuid-1234-5678");
        assert_eq!(challenge.challenge.random_data, "a1b2c3d4e5f67890");

        let solution = AnubisSolver::solve(&challenge);
        assert!(solution.response_hash.starts_with("00"));
        assert_eq!(solution.challenge_id, "test-uuid-1234-5678");

        // Verify SHA256 matches
        let mut hasher = Sha256::new();
        hasher.update(challenge.challenge.random_data.as_bytes());
        hasher.update(solution.nonce.to_string().as_bytes());
        assert_eq!(hex::encode(hasher.finalize()), solution.response_hash);
    }

    #[test]
    fn test_extract_anubis_different_attribute_order() {
        let flipped_html = r#"<script type="application/json" id="anubis_challenge">{"challenge":{"id":"1","randomData":"abc"}}</script>"#;
        let challenge1 = AnubisSolver::extract_challenge(flipped_html).expect("extract flipped");
        assert_eq!(challenge1.challenge.id, "1");

        let single_quote_html = r#"<script type='application/json' id='anubis_challenge'>{"challenge":{"id":"2","randomData":"xyz"}}</script>"#;
        let challenge2 = AnubisSolver::extract_challenge(single_quote_html).expect("extract single quote");
        assert_eq!(challenge2.challenge.id, "2");
    }
}
