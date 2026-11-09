use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::RwLock;

const DEFAULT_TMDB_KEY: &str = "4e44d9029b1270a757cddc766a1bcb63";
const TMDB_SEARCH_URL: &str = "https://api.themoviedb.org/3/search/multi";

#[derive(Debug, Deserialize)]
struct TmdbSearchResponse {
    #[serde(default)]
    results: Vec<TmdbSearchResult>,
}

#[derive(Debug, Deserialize)]
struct TmdbSearchResult {
    backdrop_path: Option<String>,
    #[serde(default)]
    vote_count: u32,
    #[serde(default)]
    popularity: f64,
    release_date: Option<String>,
    first_air_date: Option<String>,
}

#[derive(Clone)]
pub struct TmdbService {
    client: Client,
    cache: Arc<RwLock<HashMap<String, Option<String>>>>,
    api_key: String,
}

impl TmdbService {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(3))
            .user_agent("RDX-Cinema/1.0")
            .build()
            .unwrap_or_default();

        Self {
            client,
            cache: Arc::new(RwLock::new(HashMap::new())),
            api_key: DEFAULT_TMDB_KEY.to_string(),
        }
    }

    fn generate_candidates(title: &str, orig_title: Option<&str>) -> Vec<String> {
        let mut candidates = Vec::new();

        if let Some(orig) = orig_title {
            let trimmed = orig.trim();
            if !trimmed.is_empty() {
                candidates.push(trimmed.to_string());
            }
        }

        // Split on slash variants if title is e.g. "1+1 / Неприкасаемые"
        let parts: Vec<&str> = title.split('/').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        for part in parts {
            let cleaned = part
                .replace("(все сезоны)", "")
                .replace("(сериал)", "")
                .trim()
                .to_string();
            if !cleaned.is_empty() && !candidates.contains(&cleaned) {
                candidates.push(cleaned);
            }
        }

        if candidates.is_empty() && !title.trim().is_empty() {
            candidates.push(title.trim().to_string());
        }

        candidates
    }

    pub async fn get_backdrop(&self, title: &str, orig_title: Option<&str>, year: Option<&str>) -> Option<String> {
        let cache_key = format!(
            "{}:{}:{}",
            title.trim(),
            orig_title.unwrap_or("").trim(),
            year.unwrap_or("").trim()
        );

        // Fast in-memory cache lookup
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.get(&cache_key) {
                return cached.clone();
            }
        }

        let candidates = Self::generate_candidates(title, orig_title);
        let mut best_match: Option<(f64, String)> = None;

        for candidate in candidates {
            let encoded_query = urlencoding::encode(&candidate);
            let url = format!(
                "{}?api_key={}&query={}&include_adult=false&language=uk-UA",
                TMDB_SEARCH_URL, self.api_key, encoded_query
            );

            if let Ok(resp) = self.client.get(&url).send().await {
                if let Ok(data) = resp.json::<TmdbSearchResponse>().await {
                    for item in data.results {
                        if let Some(path) = item.backdrop_path {
                            if !path.is_empty() {
                                let mut score = (item.vote_count as f64) * 2.0 + item.popularity;
                                if let Some(y) = year {
                                    let rel_date = item
                                        .release_date
                                        .as_deref()
                                        .or(item.first_air_date.as_deref())
                                        .unwrap_or("");
                                    if rel_date.contains(y) {
                                        score += 1500.0;
                                    }
                                }

                                if let Some((best_score, _)) = &best_match {
                                    if score > *best_score {
                                        best_match = Some((
                                            score,
                                            format!("https://image.tmdb.org/t/p/original{}", path),
                                        ));
                                    }
                                } else {
                                    best_match = Some((
                                        score,
                                        format!("https://image.tmdb.org/t/p/original{}", path),
                                    ));
                                }
                            }
                        }
                    }
                }
            }

            // High-confidence match found (e.g. popular title with many votes)
            if let Some((score, _)) = &best_match {
                if *score > 100.0 {
                    break;
                }
            }
        }

        let found_backdrop = best_match.map(|(_, url)| url);

        // Write to cache (even if None, to prevent spamming failed queries)
        let mut cache = self.cache.write().await;
        cache.insert(cache_key, found_backdrop.clone());

        found_backdrop
    }
}
