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
    id: Option<u64>,
    backdrop_path: Option<String>,
    poster_path: Option<String>,
    media_type: Option<String>,
    original_language: Option<String>,
    title: Option<String>,
    original_title: Option<String>,
    name: Option<String>,
    original_name: Option<String>,
    #[serde(default)]
    vote_count: u32,
    #[serde(default)]
    popularity: f64,
    #[serde(default)]
    genre_ids: Vec<u32>,
    release_date: Option<String>,
    first_air_date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TmdbRecommendation {
    pub title: String,
    pub orig_title: Option<String>,
    pub year: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TmdbLocalizedMetadata {
    pub title: Option<String>,
    pub overview: Option<String>,
    pub poster: Option<String>,
    pub backdrop: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TmdbImageItem {
    file_path: Option<String>,
    iso_639_1: Option<String>,
    #[serde(default)]
    vote_average: f64,
}

#[derive(Debug, Deserialize)]
struct TmdbImagesResponse {
    #[serde(default)]
    posters: Vec<TmdbImageItem>,
}

#[derive(Debug, Deserialize)]
struct TmdbDetailsResponse {
    title: Option<String>,
    name: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    images: Option<TmdbImagesResponse>,
}

#[derive(Clone)]
pub struct TmdbService {
    client: Client,
    cache: Arc<RwLock<HashMap<String, Option<String>>>>,
    poster_cache: Arc<RwLock<HashMap<String, Option<String>>>>,
    meta_cache: Arc<RwLock<HashMap<String, Option<TmdbLocalizedMetadata>>>>,
    id_cache: Arc<RwLock<HashMap<String, Option<(String, u64)>>>>,
    rec_cache: Arc<RwLock<HashMap<String, Vec<crate::parser::MediaCard>>>>,
    api_key: String,
}

impl TmdbService {
    pub fn new() -> Self {
        let client = Client::builder()
            .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
            .timeout(Duration::from_secs(5))
            .user_agent("RDX-Cinema/1.0")
            .build()
            .unwrap_or_default();

        Self {
            client,
            cache: Arc::new(RwLock::new(HashMap::new())),
            poster_cache: Arc::new(RwLock::new(HashMap::new())),
            meta_cache: Arc::new(RwLock::new(HashMap::new())),
            id_cache: Arc::new(RwLock::new(HashMap::new())),
            rec_cache: Arc::new(RwLock::new(HashMap::new())),
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

    fn normalize_title(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let mut prev_space = true;
        for ch in s.chars() {
            if ch.is_alphanumeric() {
                for lc in ch.to_lowercase() {
                    out.push(lc);
                }
                prev_space = false;
            } else if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        }
        out.trim().to_string()
    }

    fn best_title_match_score(candidates: &[String], item: &TmdbSearchResult) -> Option<f64> {
        let item_titles: Vec<String> = [
            item.title.as_deref(),
            item.original_title.as_deref(),
            item.name.as_deref(),
            item.original_name.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(Self::normalize_title)
        .filter(|s| !s.is_empty())
        .collect();

        if item_titles.is_empty() {
            return None;
        }

        let mut best: Option<f64> = None;

        for cand in candidates {
            let norm_cand = Self::normalize_title(cand);
            if norm_cand.is_empty() {
                continue;
            }
            let cand_words: Vec<&str> = norm_cand.split_whitespace().collect();

            for norm_item in &item_titles {
                if norm_item == &norm_cand {
                    return Some(150_000.0);
                }

                let item_words: Vec<&str> = norm_item.split_whitespace().collect();
                if cand_words.is_empty() || item_words.is_empty() {
                    continue;
                }

                let shared = cand_words
                    .iter()
                    .filter(|w| item_words.contains(w))
                    .count();
                let max_len = cand_words.len().max(item_words.len());
                let ratio = shared as f64 / max_len as f64;

                // Allow close multi-word matches (e.g. subtitle/season suffix) but reject unrelated franchises
                // such as "Castlevania: Nocturne" when searching for "Nocturne".
                if max_len >= 2 && ratio >= 0.75 {
                    let score = 50_000.0 * ratio;
                    best = Some(best.map_or(score, |b| b.max(score)));
                }
            }
        }

        best
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
        let mut best_match: Option<(f64, String, Option<(String, u64)>)> = None;
        let expected_year: Option<i32> = year.and_then(|y| y.trim().get(..4)).and_then(|y| y.parse().ok());
        let orig_has_cyrillic = orig_title
            .map(|o| o.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c)))
            .unwrap_or(false);
        let orig_is_latin_only = orig_title
            .map(|o| {
                let trimmed = o.trim();
                !trimmed.is_empty()
                    && trimmed.chars().any(|c| c.is_ascii_alphabetic())
                    && !trimmed.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c))
            })
            .unwrap_or(false);

        let (search_endpoint, year_param) = match (media_type, expected_year) {
            (Some("movie"), Some(y)) => ("https://api.themoviedb.org/3/search/movie", Some(format!("&year={}", y))),
            (Some("tv"), Some(y)) => ("https://api.themoviedb.org/3/search/tv", Some(format!("&first_air_date_year={}", y))),
            (Some("movie"), None) => ("https://api.themoviedb.org/3/search/movie", None),
            (Some("tv"), None) => ("https://api.themoviedb.org/3/search/tv", None),
            _ => (TMDB_SEARCH_URL, None),
        };

        for lang in ["uk-UA", "ru-RU"] {
            for candidate in &candidates {
                let encoded_query = urlencoding::encode(candidate);
                let url = format!(
                    "{}?api_key={}&query={}&include_adult=false&language={}{}",
                    search_endpoint,
                    self.api_key,
                    encoded_query,
                    lang,
                    year_param.as_deref().unwrap_or("")
                );

                if let Ok(resp) = self.client.get(&url).send().await {
                    if let Ok(data) = resp.json::<TmdbSearchResponse>().await {
                        for item in data.results {
                            let Some(path) = item.backdrop_path.as_ref() else { continue };
                            if path.is_empty() {
                                continue;
                            }

                            // Strictly filter out wrong media_type (e.g. TV series for a movie)
                            let item_type = item.media_type.as_deref().or(media_type).unwrap_or("");
                            if let Some(exp) = media_type {
                                if (item_type == "movie" || item_type == "tv") && item_type != exp {
                                    continue;
                                }
                            } else if item_type == "person" {
                                continue;
                            }

                            // Prevent Cyrillic-original CIS titles (e.g. "Вечеринка / Вечірка") from matching
                            // unrelated Western/Asian shows (e.g. Apple TV+ "The Afterparty"), and vice versa.
                            if let Some(ref orig_lang) = item.original_language {
                                let is_slavic_lang = matches!(
                                    orig_lang.as_str(),
                                    "uk" | "ru" | "be" | "kk" | "pl" | "cs" | "sk" | "bg" | "sr" | "hr"
                                );
                                if orig_has_cyrillic && !is_slavic_lang {
                                    continue;
                                }
                                if orig_is_latin_only && (orig_lang == "uk" || orig_lang == "ru") {
                                    continue;
                                }
                            }

                            // Require title similarity so TMDB never substitutes an unrelated franchise
                            let Some(title_score) = Self::best_title_match_score(&candidates, &item) else {
                                continue;
                            };

                            // Reject results whose release year is off by >= 2 years
                            let mut year_score = 0.0;
                            if let Some(exp_y) = expected_year {
                                let rel_date = item
                                    .release_date
                                    .as_deref()
                                    .or(item.first_air_date.as_deref())
                                    .unwrap_or("");
                                if let Some(item_y) = rel_date.get(..4).and_then(|y| y.parse::<i32>().ok()) {
                                    let diff = (item_y - exp_y).abs();
                                    if diff == 0 {
                                        year_score = 100_000.0;
                                    } else if diff == 1 {
                                        year_score = 40_000.0;
                                    } else {
                                        continue;
                                    }
                                }
                            }

                            let mut score = title_score + year_score + (item.vote_count as f64) * 2.0 + item.popularity;

                            if media_type.is_some() && item_type == media_type.unwrap_or("") {
                                score += 20_000.0;
                            }

                            let full_url = format!("https://image.tmdb.org/t/p/original{}", path);
                            let tmdb_identity = item.id.and_then(|tid| {
                                let t = if item_type == "movie" || item_type == "tv" {
                                    item_type
                                } else {
                                    media_type.unwrap_or("movie")
                                };
                                Some((t.to_string(), tid))
                            });
                            match &best_match {
                                Some((best_score, _, _)) if score <= *best_score => {}
                                _ => best_match = Some((score, full_url, tmdb_identity)),
                            }
                        }
                    }
                }

                // Early-exit only when we have an exact title + strong year match
                if let Some((score, _, _)) = &best_match {
                    let threshold = if expected_year.is_some() { 250_000.0 } else { 150_000.0 };
                    if *score >= threshold {
                        break;
                    }
                }
            }

            if best_match.is_some() {
                break;
            }
        }

        let found_identity = best_match.as_ref().and_then(|(_, _, id)| id.clone());
        let found_backdrop = best_match.map(|(_, url, _)| url);

        // Write to cache (even if None, to prevent spamming failed queries)
        {
            let mut cache = self.cache.write().await;
            cache.insert(cache_key.clone(), found_backdrop.clone());
        }
        {
            let mut id_cache = self.id_cache.write().await;
            id_cache.insert(cache_key, found_identity);
        }

        found_backdrop
    }

    pub async fn get_cached_recommendations(&self, key: &str) -> Option<Vec<crate::parser::MediaCard>> {
        let cache = self.rec_cache.read().await;
        cache.get(key).cloned()
    }

    pub async fn cache_recommendations(&self, key: String, items: Vec<crate::parser::MediaCard>) {
        let mut cache = self.rec_cache.write().await;
        cache.insert(key, items);
    }

    pub async fn get_recommendations_list(
        &self,
        title: &str,
        orig_title: Option<&str>,
        year: Option<&str>,
        media_type: Option<&str>,
    ) -> Vec<TmdbRecommendation> {
        let cache_key = format!(
            "{}:{}:{}:{}",
            title.trim(),
            orig_title.unwrap_or("").trim(),
            year.unwrap_or("").trim(),
            media_type.unwrap_or("").trim()
        );

        let identity = {
            let id_cache = self.id_cache.read().await;
            id_cache.get(&cache_key).cloned().flatten()
        };

        let (mtype, tmdb_id) = match identity {
            Some(pair) => pair,
            None => {
                // Ensure search runs once to populate id_cache
                let _ = self.get_backdrop(title, orig_title, year, media_type).await;
                let id_cache = self.id_cache.read().await;
                match id_cache.get(&cache_key).cloned().flatten() {
                    Some(pair) => pair,
                    None => return vec![],
                }
            }
        };

        let url = format!(
            "https://api.themoviedb.org/3/{}/{}/recommendations?api_key={}&language=uk-UA&page=1",
            mtype, tmdb_id, self.api_key
        );

        let Ok(resp) = self.client.get(&url).send().await else {
            return vec![];
        };
        let Ok(data) = resp.json::<TmdbSearchResponse>().await else {
            return vec![];
        };

        data.results
            .into_iter()
            .filter_map(|item| {
                let rec_title = item.title.or(item.name)?.trim().to_string();
                if rec_title.is_empty() {
                    return None;
                }
                let rec_orig = item
                    .original_title
                    .or(item.original_name)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                let rec_year = item
                    .release_date
                    .or(item.first_air_date)
                    .and_then(|d| d.get(..4).map(|y| y.to_string()));
                Some(TmdbRecommendation {
                    title: rec_title,
                    orig_title: rec_orig,
                    year: rec_year,
                })
            })
            .take(10)
            .collect()
    }

    pub async fn get_poster(&self, title: &str, year: Option<&str>) -> Option<String> {
        let cache_key = format!("{}|{}", title.trim().to_lowercase(), year.unwrap_or(""));
        if let Some(cached) = self.poster_cache.read().await.get(&cache_key).cloned() {
            return cached;
        }

        let expected_year = year.and_then(|y| y.trim().get(..4)).and_then(|y| y.parse::<i32>().ok());
        let mut queries: Vec<String> = Vec::new();
        for part in title.split('/') {
            let trimmed = part.trim();
            if !trimmed.is_empty() && !queries.iter().any(|q| q.eq_ignore_ascii_case(trimmed)) {
                queries.push(trimmed.to_string());
            }
        }
        if queries.is_empty() {
            return None;
        }

        let mut best_match: Option<(f64, String)> = None;

        for query in &queries {
            let encoded = urlencoding::encode(query);
            let url = format!(
                "{}?api_key={}&query={}&include_adult=false&language=uk-UA",
                TMDB_SEARCH_URL, self.api_key, encoded
            );

            if let Ok(resp) = self.client.get(&url).send().await {
                if let Ok(data) = resp.json::<TmdbSearchResponse>().await {
                    for item in data.results {
                        if item.media_type.as_deref() == Some("person") {
                            continue;
                        }
                        let Some(path) = item.poster_path.as_ref() else {
                            continue;
                        };
                        if path.is_empty() {
                            continue;
                        }

                        let mut year_score = 0.0;
                        if let Some(exp_y) = expected_year {
                            let rel = item
                                .release_date
                                .as_deref()
                                .or(item.first_air_date.as_deref())
                                .unwrap_or("");
                            if let Some(item_y) = rel.get(..4).and_then(|y| y.parse::<i32>().ok()) {
                                let diff = (item_y - exp_y).abs();
                                if diff == 0 {
                                    year_score = 100_000.0;
                                } else if diff == 1 {
                                    year_score = 40_000.0;
                                } else {
                                    continue;
                                }
                            }
                        }

                        let title_score = Self::best_title_match_score(&queries, &item).unwrap_or(1_000.0);
                        let score = year_score + title_score + (item.popularity * 100.0) + ((item.vote_count as f64) * 10.0);

                        if best_match.as_ref().map_or(true, |(best_s, _)| score > *best_s) {
                            best_match = Some((score, format!("https://image.tmdb.org/t/p/w500{}", path)));
                        }
                    }
                }
            }

            if best_match.as_ref().map_or(false, |(s, _)| *s >= 100_000.0) {
                break;
            }
        }

        let result = best_match.map(|(_, url)| url);
        self.poster_cache.write().await.insert(cache_key, result.clone());
        result
    }

    fn pick_preferred_poster(images: &[TmdbImageItem], fallback_path: Option<&str>) -> Option<String> {
        let pick_by_lang = |target_lang: Option<&str>| -> Option<String> {
            images
                .iter()
                .filter(|img| img.iso_639_1.as_deref() == target_lang)
                .filter_map(|img| {
                    let path = img.file_path.as_deref()?.trim();
                    if path.is_empty() {
                        None
                    } else {
                        Some((img.vote_average, path))
                    }
                })
                .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(_, path)| format!("https://image.tmdb.org/t/p/w500{}", path))
        };

        pick_by_lang(Some("uk"))
            .or_else(|| pick_by_lang(Some("en")))
            .or_else(|| pick_by_lang(None))
            .or_else(|| {
                fallback_path
                    .map(str::trim)
                    .filter(|p| !p.is_empty())
                    .map(|p| format!("https://image.tmdb.org/t/p/w500{}", p))
            })
    }

    pub async fn get_localized_metadata(
        &self,
        title: &str,
        orig_title: Option<&str>,
        year: Option<&str>,
        media_type: Option<&str>,
    ) -> Option<TmdbLocalizedMetadata> {
        let cache_key = format!(
            "{}:{}:{}:{}",
            title.trim(),
            orig_title.unwrap_or("").trim(),
            year.unwrap_or("").trim(),
            media_type.unwrap_or("").trim()
        );

        if let Some(cached) = self.meta_cache.read().await.get(&cache_key).cloned() {
            return cached;
        }

        let backdrop_from_search = self.get_backdrop(title, orig_title, year, media_type).await;
        let identity = self.id_cache.read().await.get(&cache_key).cloned().flatten();

        let Some((mtype, tmdb_id)) = identity else {
            let fallback = backdrop_from_search.map(|backdrop| TmdbLocalizedMetadata {
                title: None,
                overview: None,
                poster: None,
                backdrop: Some(backdrop),
            });
            self.meta_cache.write().await.insert(cache_key, fallback.clone());
            return fallback;
        };

        let url = format!(
            "https://api.themoviedb.org/3/{}/{}?api_key={}&language=uk-UA&append_to_response=images&include_image_language=uk,en,null",
            mtype, tmdb_id, self.api_key
        );

        let mut meta = TmdbLocalizedMetadata {
            title: None,
            overview: None,
            poster: None,
            backdrop: backdrop_from_search,
        };

        if let Ok(resp) = self.client.get(&url).send().await {
            if let Ok(data) = resp.json::<TmdbDetailsResponse>().await {
                meta.title = data
                    .title
                    .or(data.name)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                meta.overview = data
                    .overview
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                let posters = data.images.as_ref().map(|i| i.posters.as_slice()).unwrap_or(&[]);
                meta.poster = Self::pick_preferred_poster(posters, data.poster_path.as_deref());

                if meta.backdrop.is_none() {
                    meta.backdrop = data
                        .backdrop_path
                        .as_deref()
                        .map(str::trim)
                        .filter(|p| !p.is_empty())
                        .map(|p| format!("https://image.tmdb.org/t/p/original{}", p));
                }
            }
        }

        let result = if meta.title.is_some()
            || meta.overview.is_some()
            || meta.poster.is_some()
            || meta.backdrop.is_some()
        {
            Some(meta)
        } else {
            None
        };

        let mut cache = self.meta_cache.write().await;
        if cache.len() >= 300 {
            cache.clear();
        }
        cache.insert(cache_key, result.clone());
        result
    }

    /// Lightweight single-request TMDB lookup for Home/Catalog cards (`uk-UA` title + poster).
    pub async fn get_card_localization(
        &self,
        title: &str,
        orig_title: Option<&str>,
        year: Option<&str>,
        media_type: Option<&str>,
        is_animation: bool,
    ) -> (Option<String>, Option<String>) {
        let mut candidates = Self::generate_candidates(title, orig_title);
        for part in title.split('/') {
            let trimmed = part.trim();
            if !trimmed.is_empty() && !candidates.iter().any(|c| c.eq_ignore_ascii_case(trimmed)) {
                candidates.push(trimmed.to_string());
            }
        }
        if candidates.is_empty() {
            return (None, None);
        }

        let has_orig = orig_title.map(|o| !o.trim().is_empty()).unwrap_or(false);
        let expected_year: Option<i32> = year.and_then(|y| y.trim().get(..4)).and_then(|y| y.parse().ok());
        let (search_endpoint, year_param) = match (media_type, expected_year) {
            (Some("movie"), Some(y)) => ("https://api.themoviedb.org/3/search/movie", Some(format!("&year={}", y))),
            (Some("tv"), Some(y)) => ("https://api.themoviedb.org/3/search/tv", Some(format!("&first_air_date_year={}", y))),
            (Some("movie"), None) => ("https://api.themoviedb.org/3/search/movie", None),
            (Some("tv"), None) => ("https://api.themoviedb.org/3/search/tv", None),
            _ => (TMDB_SEARCH_URL, None),
        };

        let mut best: Option<(f64, Option<String>, Option<String>)> = None;

        for candidate in candidates.iter().take(3) {
            let encoded = urlencoding::encode(candidate);
            let url = format!(
                "{}?api_key={}&query={}&include_adult=false&language=uk-UA{}",
                search_endpoint,
                self.api_key,
                encoded,
                year_param.as_deref().unwrap_or("")
            );

            let Ok(resp) = self.client.get(&url).send().await else {
                continue;
            };
            let Ok(data) = resp.json::<TmdbSearchResponse>().await else {
                continue;
            };

            for item in data.results {
                let item_type = item.media_type.as_deref().or(media_type).unwrap_or("");
                if item_type == "person" {
                    continue;
                }
                if let Some(exp) = media_type {
                    if (item_type == "movie" || item_type == "tv") && item_type != exp {
                        continue;
                    }
                }

                let title_score_opt = Self::best_title_match_score(&candidates, &item);
                // If we have neither a release year nor an original title, require a title match
                // so ambiguous queries (like "Одиссей" without year) don't pick a random film.
                if expected_year.is_none() && !has_orig && title_score_opt.is_none() {
                    continue;
                }
                let title_score = title_score_opt.unwrap_or(0.0);

                let mut year_score = 0.0;
                if let Some(exp_y) = expected_year {
                    let rel = item
                        .release_date
                        .as_deref()
                        .or(item.first_air_date.as_deref())
                        .unwrap_or("");
                    if let Some(item_y) = rel.get(..4).and_then(|y| y.parse::<i32>().ok()) {
                        let diff = (item_y - exp_y).abs();
                        if diff == 0 {
                            year_score = 100_000.0;
                        } else if diff == 1 {
                            year_score = 40_000.0;
                        } else {
                            continue;
                        }
                    }
                }

                let mut genre_score = 0.0;
                if is_animation && !item.genre_ids.is_empty() {
                    if item.genre_ids.contains(&16) {
                        genre_score = 80_000.0;
                    } else {
                        genre_score = -100_000.0;
                    }
                }

                let uk_title = item
                    .title
                    .or(item.name)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                let uk_poster = item
                    .poster_path
                    .as_deref()
                    .map(str::trim)
                    .filter(|p| !p.is_empty())
                    .map(|p| format!("https://image.tmdb.org/t/p/w500{}", p));

                if uk_title.is_none() && uk_poster.is_none() {
                    continue;
                }

                let score = year_score + genre_score + title_score + (item.popularity * 100.0) + ((item.vote_count as f64) * 10.0);
                if score <= 0.0 && is_animation && !item.genre_ids.is_empty() && !item.genre_ids.contains(&16) {
                    continue;
                }
                if best.as_ref().map_or(true, |(bs, _, _)| score > *bs) {
                    best = Some((score, uk_title, uk_poster));
                }
            }

            if best.as_ref().map_or(false, |(s, _, _)| *s >= 150_000.0) {
                break;
            }
        }

        match best {
            Some((_, t, p)) => (t, p),
            None => (None, None),
        }
    }

    /// Resolves a Ukrainian/localized search query into top TMDB original titles for searching HDRezka.
    pub async fn search_original_titles(&self, query: &str) -> Vec<String> {
        let trimmed = query.trim();
        if trimmed.len() < 2 {
            return vec![];
        }
        let encoded = urlencoding::encode(trimmed);
        let url = format!(
            "{}?api_key={}&query={}&include_adult=false&language=uk-UA",
            TMDB_SEARCH_URL, self.api_key, encoded
        );
        let Ok(resp) = self.client.get(&url).send().await else {
            return vec![];
        };
        let Ok(data) = resp.json::<TmdbSearchResponse>().await else {
            return vec![];
        };

        let mut out: Vec<String> = Vec::new();
        for item in data.results {
            if item.media_type.as_deref() == Some("person") {
                continue;
            }
            let orig = item
                .original_title
                .or(item.original_name)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            if let Some(o) = orig {
                if !o.eq_ignore_ascii_case(trimmed) && !out.iter().any(|x| x.eq_ignore_ascii_case(&o)) {
                    out.push(o);
                    if out.len() >= 3 {
                        break;
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pick_preferred_poster_prioritizes_uk_then_en_then_null() {
        let items = vec![
            TmdbImageItem {
                file_path: Some("/null_poster.jpg".to_string()),
                iso_639_1: None,
                vote_average: 9.0,
            },
            TmdbImageItem {
                file_path: Some("/en_poster.jpg".to_string()),
                iso_639_1: Some("en".to_string()),
                vote_average: 8.0,
            },
            TmdbImageItem {
                file_path: Some("/uk_poster.jpg".to_string()),
                iso_639_1: Some("uk".to_string()),
                vote_average: 5.0,
            },
        ];
        assert_eq!(
            TmdbService::pick_preferred_poster(&items, Some("/fallback.jpg")).as_deref(),
            Some("https://image.tmdb.org/t/p/w500/uk_poster.jpg")
        );

        let no_uk = &items[..2];
        assert_eq!(
            TmdbService::pick_preferred_poster(no_uk, Some("/fallback.jpg")).as_deref(),
            Some("https://image.tmdb.org/t/p/w500/en_poster.jpg")
        );
    }
}
