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
    media_type: Option<String>,
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
            for part in orig.split('/').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                let cleaned = part.to_string();
                if !candidates.contains(&cleaned) {
                    candidates.push(cleaned);
                }
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

    pub async fn get_backdrop(
        &self,
        title: &str,
        orig_title: Option<&str>,
        year: Option<&str>,
        media_type: Option<&str>,
    ) -> Option<String> {
        let cache_key = format!(
            "{}:{}:{}:{}",
            title.trim(),
            orig_title.unwrap_or("").trim(),
            year.unwrap_or("").trim(),
            media_type.unwrap_or("").trim()
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
        let expected_year: Option<i32> = year.and_then(|y| y.trim().get(..4)).and_then(|y| y.parse().ok());

        for candidate in candidates {
            let encoded_query = urlencoding::encode(&candidate);
            let url = format!(
                "{}?api_key={}&query={}&include_adult=false&language=uk-UA",
                TMDB_SEARCH_URL, self.api_key, encoded_query
            );

            if let Ok(resp) = self.client.get(&url).send().await {
                if let Ok(data) = resp.json::<TmdbSearchResponse>().await {
                    for item in data.results {
                        let Some(path) = item.backdrop_path else { continue };
                        if path.is_empty() {
                            continue;
                        }

                        // Strictly filter out wrong media_type (e.g. TV series for a movie)
                        let item_type = item.media_type.as_deref().unwrap_or("");
                        if let Some(exp) = media_type {
                            if (item_type == "movie" || item_type == "tv") && item_type != exp {
                                continue;
                            }
                        } else if item_type == "person" {
                            continue;
                        }

                        let mut score = (item.vote_count as f64) * 2.0 + item.popularity;

                        if media_type.is_some() && item_type == media_type.unwrap_or("") {
                            score += 20_000.0;
                        }

                        if let Some(exp_y) = expected_year {
                            let rel_date = item
                                .release_date
                                .as_deref()
                                .or(item.first_air_date.as_deref())
                                .unwrap_or("");
                            if let Some(item_y) = rel_date.get(..4).and_then(|y| y.parse::<i32>().ok()) {
                                let diff = (item_y - exp_y).abs();
                                if diff == 0 {
                                    score += 100_000.0;
                                } else if diff == 1 {
                                    score += 40_000.0;
                                } else {
                                    score -= 50_000.0;
                                }
                            }
                        }

                        let full_url = format!("https://image.tmdb.org/t/p/original{}", path);
                        match &best_match {
                            Some((best_score, _)) if score <= *best_score => {}
                            _ => best_match = Some((score, full_url)),
                        }
                    }
                }
            }

            // Early-exit only when we have a strong year+type match (or no year constraint)
            if let Some((score, _)) = &best_match {
                let threshold = if expected_year.is_some() { 100_000.0 } else { 100.0 };
                if *score >= threshold {
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
