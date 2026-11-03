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

pub struct AnubisSolver;

impl AnubisSolver {
    /// Detects if HTML page is an Anubis PoW challenge page
    pub fn is_anubis_challenge(html: &str) -> bool {
        html.contains("id=\"anubis_challenge\"")
            || html.contains("Проверяем, что вы не бот")
            || html.contains("/.within.website/x/cmd/anubis/")
    }

    /// Extracts Anubis challenge payload from HTML
    pub fn extract_challenge(html: &str) -> Option<AnubisChallengePayload> {
        let tag = "<script id=\"anubis_challenge\" type=\"application/json\">";
        let start_idx = html.find(tag)? + tag.len();
        let end_idx = html[start_idx..].find("</script>")? + start_idx;
        let json_str = html[start_idx..end_idx].trim();
        serde_json::from_str::<AnubisChallengePayload>(json_str).ok()
    }

    /// Solves the PoW challenge: finds nonce such that SHA256(random_data + nonce)
    /// has `difficulty` leading hex zeros.
    pub fn solve(challenge: &AnubisChallengePayload) -> AnubisSolution {
        let start = std::time::Instant::now();
        let difficulty = challenge
            .challenge
            .difficulty
            .or_else(|| challenge.rules.as_ref().and_then(|r| r.difficulty))
            .unwrap_or(2);

        let random_data = &challenge.challenge.random_data;
        let target_prefix = "0".repeat(difficulty as usize);

        let mut nonce: u64 = 0;
        let response_hash: String;

        loop {
            let mut hasher = Sha256::new();
            hasher.update(random_data.as_bytes());
            hasher.update(nonce.to_string().as_bytes());
            let result = hasher.finalize();
            let hex_result = hex::encode(result);

            if hex_result.starts_with(&target_prefix) {
                response_hash = hex_result;
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
}
